
<?php

/**
 * Foundev Institute Dashboard API
 * Path: institute-users/api/admin/admin-dashboard.php
 *
 * Authentication:
 * backend/auth/require-institute-admin.php
 */

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

/**
 * Standard JSON response.
 */
function institute_dashboard_response(
    int $status,
    bool $success,
    string $message,
    array $data = []
): never {
    http_response_code($status);

    echo json_encode([
        'success' => $success,
        'message' => $message,
        'data' => $data
    ], JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);

    exit;
}

/**
 * Only GET requests are allowed.
 */
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');

    institute_dashboard_response(
        405,
        false,
        'Method not allowed.'
    );
}

try {

    /*
    |--------------------------------------------------------------------------
    | Load institute administrator authentication
    |--------------------------------------------------------------------------
    */

    $root = dirname(__DIR__, 3);

    $authFile = $root . '/backend/auth/require-institute-admin.php';

    if (!is_file($authFile)) {
        throw new RuntimeException(
            'Institute authentication file is missing.'
        );
    }

    require_once $authFile;

    /*
    |--------------------------------------------------------------------------
    | Validate authenticated administrator
    |--------------------------------------------------------------------------
    */

    if (
        !isset($instituteAdminId, $instituteApplicationId) ||
        $instituteAdminId < 1 ||
        $instituteApplicationId < 1
    ) {
        institute_dashboard_response(
            401,
            false,
            'Your session has expired. Please sign in again.'
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Administrator details from session
    |--------------------------------------------------------------------------
    */

    $name = trim(
        (string) ($_SESSION['institute_admin_name'] ?? 'Administrator')
    );

    $email = trim(
        (string) ($_SESSION['institute_admin_email'] ?? '')
    );

    /*
    |--------------------------------------------------------------------------
    | Dashboard response
    |--------------------------------------------------------------------------
    */

    institute_dashboard_response(
        200,
        true,
        'Dashboard data retrieved successfully.',
        [
            'administrator' => [
                'id' => (int) $instituteAdminId,
                'name' => $name !== '' ? $name : 'Administrator',
                'email' => $email
            ],

            'institution' => [
                'application_id' => (int) $instituteApplicationId
            ],

            'stats' => [
                'students' => null,
                'mentors' => null,
                'projects' => null,
                'assessments' => null
            ],

            'activity' => []
        ]
    );

} catch (Throwable $e) {

    error_log(
        '[Foundev Institute Dashboard API] ' .
        get_class($e) . ': ' . $e->getMessage()
    );

    institute_dashboard_response(
        500,
        false,
        'Unable to load the institute dashboard.'
    );
}
