
<?php

/**
 * Foundev — Verify Institute Student Profiles
 * Path: institute-users/api/admin/verify-students.php
 *
 * Accepts:
 * {
 *   "student_usernames": ["username1", "username2"]
 * }
 *
 * Verifies 1–3 active students belonging to the authenticated,
 * approved institution and returns their profiles.
 *
 * This endpoint does NOT create orders or grant project access.
 */



ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');

function verify_students_response(
    int $status,
    bool $success,
    string $message,
    array $data = []
): never {
    http_response_code($status);

    echo json_encode(
        [
            'success' => $success,
            'message' => $message,
            'data' => $data
        ],
        JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    );

    exit;
}

/*
|--------------------------------------------------------------------------
| 1. Validate request method
|--------------------------------------------------------------------------
*/

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');

    verify_students_response(
        405,
        false,
        'Only POST requests are allowed.'
    );
}

/*
|--------------------------------------------------------------------------
| 2. Validate JSON input
|--------------------------------------------------------------------------
*/

$contentType = $_SERVER['CONTENT_TYPE'] ?? '';

if (stripos($contentType, 'application/json') === false) {
    verify_students_response(
        415,
        false,
        'Send the request as JSON.'
    );
}

try {
    $raw = file_get_contents('php://input');

    $input = json_decode(
        $raw === false ? '' : $raw,
        true,
        512,
        JSON_THROW_ON_ERROR
    );

} catch (JsonException $e) {
    verify_students_response(
        400,
        false,
        'Invalid JSON request.'
    );
}

if (!is_array($input)) {
    verify_students_response(
        400,
        false,
        'Invalid request.'
    );
}

/*
|--------------------------------------------------------------------------
| 3. Validate student usernames
|--------------------------------------------------------------------------
*/

$usernames = $input['student_usernames'] ?? null;

if (
    !is_array($usernames) ||
    !array_is_list($usernames)
) {
    verify_students_response(
        422,
        false,
        'Student usernames must be provided as an array.'
    );
}

$count = count($usernames);

if (!in_array($count, [1, 2, 3], true)) {
    verify_students_response(
        422,
        false,
        'You must provide usernames for 1, 2 or 3 students.'
    );
}

$normalizedUsernames = [];

foreach ($usernames as $username) {

    if (!is_string($username)) {
        verify_students_response(
            422,
            false,
            'One or more usernames are invalid.'
        );
    }

    $username = trim($username);

    if (
        $username === '' ||
        mb_strlen($username) > 50 ||
        preg_match('/[\x00-\x20\x7F]/u', $username)
    ) {
        verify_students_response(
            422,
            false,
            'One or more usernames are invalid.'
        );
    }

    $normalizedUsernames[] = mb_strtolower($username);
}

/*
|--------------------------------------------------------------------------
| 4. Reject duplicate usernames
|--------------------------------------------------------------------------
*/

if (count(array_unique($normalizedUsernames)) !== $count) {
    verify_students_response(
        422,
        false,
        'Each team member must have a different username.'
    );
}

/*
|--------------------------------------------------------------------------
| 5. Load authentication and database configuration
|--------------------------------------------------------------------------
*/

$root = dirname(__DIR__, 3);

$authFile = $root . '/backend/auth/require-institute-admin.php';
$dbFile = $root . '/backend/config/db.php';

if (!is_file($authFile) || !is_file($dbFile)) {

    error_log(
        '[Foundev Verify Students] Authentication or database file missing.'
    );

    verify_students_response(
        500,
        false,
        'Student verification service is not configured.'
    );
}

require_once $authFile;
require_once $dbFile;

/*
|--------------------------------------------------------------------------
| 6. Validate authenticated administrator
|--------------------------------------------------------------------------
*/

if (
    !isset($pdo) ||
    !$pdo instanceof PDO ||
    !isset($instituteAdminId, $instituteApplicationId)
) {
    verify_students_response(
        500,
        false,
        'Unable to initialize student verification.'
    );
}

try {

    $pdo->setAttribute(
        PDO::ATTR_ERRMODE,
        PDO::ERRMODE_EXCEPTION
    );

    $pdo->setAttribute(
        PDO::ATTR_DEFAULT_FETCH_MODE,
        PDO::FETCH_ASSOC
    );

    /*
    |--------------------------------------------------------------------------
    | Verify institution administrator and application
    |--------------------------------------------------------------------------
    */

    $adminStmt = $pdo->prepare(
        "SELECT
            ia.id,
            ia.email,
            ia.account_status,

            app.id AS application_id,
            app.status AS application_status,
            app.official_email,
            app.email_verified_at

         FROM institute_admins ia

         INNER JOIN institute_applications app
            ON app.id = ia.application_id

         WHERE ia.id = :admin_id
           AND app.id = :application_id

         LIMIT 1"
    );

    $adminStmt->execute([
        'admin_id' => $instituteAdminId,
        'application_id' => $instituteApplicationId
    ]);

    $admin = $adminStmt->fetch();

    if (!$admin) {
        verify_students_response(
            403,
            false,
            'Your institution administrator account could not be verified.'
        );
    }

    if (
        strtolower((string) $admin['account_status']) !== 'active' ||
        strtolower((string) $admin['application_status']) !== 'approved' ||
        empty($admin['email_verified_at']) ||
        strtolower(trim((string) $admin['email'])) !==
            strtolower(trim((string) $admin['official_email']))
    ) {
        verify_students_response(
            403,
            false,
            'Your institution is not authorized to verify students.'
        );
    }

    /*
    |--------------------------------------------------------------------------
    | 7. Fetch active students belonging to this institution
    |--------------------------------------------------------------------------
    */

    $placeholders = [];
    $parameters = [
        'institution_id' => $instituteApplicationId
    ];

    foreach ($normalizedUsernames as $index => $username) {

        $placeholder = 'username_' . $index;

        $placeholders[] = ':' . $placeholder;

        $parameters[$placeholder] = $username;
    }

    $sql = "
        SELECT
            id,
            username,
            full_name,
            email,
            roll_number,
            course,
            academic_year,
            account_status

        FROM institute_students

        WHERE institution_id = :institution_id

          AND account_status = 'active'

          AND LOWER(username) IN (
              " . implode(', ', $placeholders) . "
          )
    ";

    $studentStmt = $pdo->prepare($sql);

    $studentStmt->execute($parameters);

    $rows = $studentStmt->fetchAll();

    /*
    |--------------------------------------------------------------------------
    | 8. Build username lookup
    |--------------------------------------------------------------------------
    */

    $studentsByUsername = [];

    foreach ($rows as $row) {

        $key = mb_strtolower(
            trim((string) $row['username'])
        );

        $studentsByUsername[$key] = $row;
    }

    /*
    |--------------------------------------------------------------------------
    | 9. Match students in submitted order
    |--------------------------------------------------------------------------
    */

    $verifiedStudents = [];

    foreach ($normalizedUsernames as $username) {

        if (!isset($studentsByUsername[$username])) {

            verify_students_response(
                422,
                false,
                'Student "' . $username .
                '" was not found as an active student in your institution.'
            );
        }

        $student = $studentsByUsername[$username];

        $verifiedStudents[] = [
            'id' => (int) $student['id'],

            'username' => (string) $student['username'],

            'full_name' => (string) $student['full_name'],

            'email' => (string) $student['email'],

            'roll_number' => $student['roll_number'],

            'course' => (string) ($student['course'] ?? ''),

            'academic_year' => $student['academic_year'],

            'account_status' => (string) $student['account_status']
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | 10. Return verified student profiles
    |--------------------------------------------------------------------------
    */

    verify_students_response(
        200,
        true,
        'Student profiles verified successfully.',
        [
            'students' => $verifiedStudents,

            'verified_count' => count($verifiedStudents),

            'institution_id' => (int) $instituteApplicationId
        ]
    );

} catch (Throwable $e) {

    error_log(
        '[Foundev Verify Students] ' .
        get_class($e) . ': ' . $e->getMessage()
    );

    verify_students_response(
        500,
        false,
        'Unable to verify student profiles. Please try again.'
    );
}
