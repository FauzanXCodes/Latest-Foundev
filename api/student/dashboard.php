
<?php

/**
 * Foundev — Institute Student Dashboard API
 * File: institute-users/api/student/dashboard.php
 *
 * Method: GET
 * Response: application/json
 *
 * Uses:
 *   Session: foundev_student_sid
 *   Database: backend/config/db.php
 *   PDO variable: $pdo
 */


header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');

function dashboardResponse(
    int $status,
    bool $success,
    string $message,
    array $extra = []
): never {
    http_response_code($status);

    echo json_encode(
        array_merge([
            'success' => $success,
            'message' => $message,
        ], $extra),
        JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    );

    exit;
}

/**
 * Check whether a database table exists.
 */
function dashboardTableExists(PDO $pdo, string $table): bool
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*)
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :table_name'
    );

    $stmt->execute(['table_name' => $table]);

    return (int) $stmt->fetchColumn() > 0;
}

/**
 * Return the available column names for an existing table.
 */
function dashboardGetColumns(PDO $pdo, string $table): array
{
    if (!dashboardTableExists($pdo, $table)) {
        return [];
    }

    // Table names here are internal constants, not user input.
    $stmt = $pdo->query(
        'SHOW COLUMNS FROM `' . str_replace('`', '``', $table) . '`'
    );

    $columns = [];

    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $column) {
        if (isset($column['Field'])) {
            $columns[] = (string) $column['Field'];
        }
    }

    return $columns;
}

/**
 * Check whether a table contains a specific column.
 */
function dashboardHasColumn(array $columns, string $column): bool
{
    return in_array($column, $columns, true);
}

/**
 * Return a column value as a string or null.
 */
function dashboardNullableString(mixed $value): ?string
{
    if ($value === null) {
        return null;
    }

    $value = trim((string) $value);

    return $value === '' ? null : $value;
}

/* ---------------------------------------------------------
   1. Only allow GET
--------------------------------------------------------- */

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');

    dashboardResponse(
        405,
        false,
        'Method not allowed.'
    );
}

/* ---------------------------------------------------------
   2. Start the same session as the login API
--------------------------------------------------------- */

$isHttps = isset($_SERVER['HTTPS'])
    && $_SERVER['HTTPS'] !== ''
    && strtolower((string) $_SERVER['HTTPS']) !== 'off';

if (session_status() !== PHP_SESSION_ACTIVE) {
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');

    session_name('foundev_student_sid');

    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $isHttps,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);

    if (!session_start()) {
        dashboardResponse(
            500,
            false,
            'Unable to start your session.'
        );
    }
}

/* ---------------------------------------------------------
   3. Verify the student session
--------------------------------------------------------- */

$studentId = filter_var(
    $_SESSION['student_id'] ?? null,
    FILTER_VALIDATE_INT,
    ['options' => ['min_range' => 1]]
);

$isAuthenticated = (
    ($_SESSION['student_authenticated'] ?? false) === true
);

if (!$isAuthenticated || !$studentId) {
    dashboardResponse(
        401,
        false,
        'Your session has expired. Please log in again.'
    );
}

/* ---------------------------------------------------------
   4. Connect to the database
--------------------------------------------------------- */

try {
    /*
     * This API is located at:
     * institute-users/api/student/dashboard.php
     *
     * The project root is three directories above this file.
     */
    $dbFile = dirname(__DIR__, 3)
        . '/backend/config/db.php';

    if (!is_file($dbFile)) {
        throw new RuntimeException(
            'Database configuration file was not found.'
        );
    }

    require_once $dbFile;

    if (!isset($pdo) || !($pdo instanceof PDO)) {
        throw new RuntimeException(
            'PDO connection is unavailable.'
        );
    }

    $pdo->setAttribute(
        PDO::ATTR_ERRMODE,
        PDO::ERRMODE_EXCEPTION
    );

    $pdo->setAttribute(
        PDO::ATTR_DEFAULT_FETCH_MODE,
        PDO::FETCH_ASSOC
    );

} catch (Throwable $e) {
    error_log(
        '[Foundev Student Dashboard] Database initialization: '
        . $e->getMessage()
    );

    dashboardResponse(
        500,
        false,
        'Unable to load your dashboard right now.'
    );
}

/* ---------------------------------------------------------
   5. Load the current student
--------------------------------------------------------- */

try {
    if (!dashboardTableExists($pdo, 'institute_students')) {
        throw new RuntimeException(
            'The institute_students table does not exist.'
        );
    }

    $studentColumns = dashboardGetColumns(
        $pdo,
        'institute_students'
    );

    $requiredColumns = [
        'id',
        'full_name',
        'email',
        'account_status',
        'email_verified_at',
    ];

    foreach ($requiredColumns as $column) {
        if (!dashboardHasColumn($studentColumns, $column)) {
            throw new RuntimeException(
                'Missing required student column: ' . $column
            );
        }
    }

    /*
     * These fields are confirmed by the existing login API.
     * Institution details are selected only if institution_id exists.
     */
    $selectColumns = [
        '`id`',
        '`full_name`',
        '`email`',
        '`account_status`',
        '`email_verified_at`',
    ];

    $hasInstitutionId = dashboardHasColumn(
        $studentColumns,
        'institution_id'
    );

    if ($hasInstitutionId) {
        $selectColumns[] = '`institution_id`';
    }

    $sql = '
        SELECT ' . implode(', ', $selectColumns) . '
        FROM `institute_students`
        WHERE `id` = :student_id
        LIMIT 1
    ';

    $stmt = $pdo->prepare($sql);

    $stmt->execute([
        'student_id' => (int) $studentId,
    ]);

    $student = $stmt->fetch();

    if (!$student) {
        // The account may have been deleted after login.
        $_SESSION = [];

        if (ini_get('session.use_cookies')) {
            $cookie = session_get_cookie_params();

            setcookie(
                session_name(),
                '',
                [
                    'expires' => time() - 42000,
                    'path' => $cookie['path'],
                    'domain' => $cookie['domain'],
                    'secure' => $cookie['secure'],
                    'httponly' => $cookie['httponly'],
                    'samesite' => $cookie['samesite'] ?? 'Lax',
                ]
            );
        }

        session_destroy();

        dashboardResponse(
            401,
            false,
            'Student account not found. Please log in again.'
        );
    }

    $accountStatus = strtolower(
        trim((string) $student['account_status'])
    );

    if ($accountStatus !== 'active') {
        session_write_close();

        dashboardResponse(
            403,
            false,
            'Your student account is not active.'
        );
    }

    if (empty($student['email_verified_at'])) {
        session_write_close();

        dashboardResponse(
            403,
            false,
            'Please verify your email before accessing the dashboard.'
        );
    }

} catch (Throwable $e) {
    error_log(
        '[Foundev Student Dashboard] Student lookup: '
        . $e->getMessage()
    );

    dashboardResponse(
        500,
        false,
        'Unable to retrieve your student profile.'
    );
}

/* ---------------------------------------------------------
   6. Load the institution name when available
--------------------------------------------------------- */

$institutionName = null;
$institutionId = null;

if (
    $hasInstitutionId &&
    isset($student['institution_id']) &&
    $student['institution_id'] !== null
) {
    $institutionId = (int) $student['institution_id'];

    try {
        if (dashboardTableExists($pdo, 'institute_applications')) {
            $institutionColumns = dashboardGetColumns(
                $pdo,
                'institute_applications'
            );

            $nameColumn = null;

            if (
                dashboardHasColumn(
                    $institutionColumns,
                    'display_name'
                )
            ) {
                $nameColumn = 'display_name';
            } elseif (
                dashboardHasColumn(
                    $institutionColumns,
                    'official_name'
                )
            ) {
                $nameColumn = 'official_name';
            }

            if (
                $nameColumn !== null &&
                dashboardHasColumn($institutionColumns, 'id')
            ) {
                $institutionSql = '
                    SELECT `' . $nameColumn . '`
                    FROM `institute_applications`
                    WHERE `id` = :institution_id
                    LIMIT 1
                ';

                $institutionStmt = $pdo->prepare($institutionSql);

                $institutionStmt->execute([
                    'institution_id' => $institutionId,
                ]);

                $institutionName = dashboardNullableString(
                    $institutionStmt->fetchColumn()
                );
            }
        }
    } catch (Throwable $e) {
        // Institution information is optional; keep the dashboard usable.
        error_log(
            '[Foundev Student Dashboard] Institution lookup: '
            . $e->getMessage()
        );
    }
}

/* ---------------------------------------------------------
   7. Prepare dashboard statistics
--------------------------------------------------------- */

/*
 * The current confirmed schema does not establish the student
 * team, request, approved-project, or notification tables.
 *
 * Return null instead of inventing counts. The frontend displays
 * a dash for these values until the actual tables are connected.
 */

$stats = [
    'team_members' => null,
    'pending_requests' => null,
    'approved_projects' => null,
    'unread_notifications' => null,
];

/* ---------------------------------------------------------
   8. Prepare recent activity
--------------------------------------------------------- */

/*
 * No confirmed student activity table is available yet.
 * Return an empty array until the real activity schema is connected.
 */

$activities = [];

/* ---------------------------------------------------------
   9. Update session profile values
--------------------------------------------------------- */

$_SESSION['student_name'] = (string) $student['full_name'];
$_SESSION['student_email'] = (string) $student['email'];

session_write_close();

/* ---------------------------------------------------------
   10. Return dashboard data
--------------------------------------------------------- */

dashboardResponse(
    200,
    true,
    'Student dashboard loaded successfully.',
    [
        'student' => [
            'id' => (int) $student['id'],
            'name' => (string) $student['full_name'],
            'email' => (string) $student['email'],
            'institution_id' => $institutionId,
            'institution_name' => $institutionName,
        ],
        'stats' => $stats,
        'activities' => $activities,
    ]
);
