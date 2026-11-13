<?php

/*
|--------------------------------------------------------------------------
| Foundev — Institution My Projects API
|--------------------------------------------------------------------------
| File: institute-users/admin/api/admin/my-projects.php
|
| Method: GET
|
| Returns paid projects belonging to the logged-in institution,
| provided that the institution still has active project assignment.
|--------------------------------------------------------------------------
*/

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');

/*
|--------------------------------------------------------------------------
| 1. JSON response helper
|--------------------------------------------------------------------------
*/

function respond(int $status, array $data): never
{
    http_response_code($status);

    echo json_encode(
        $data,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );

    exit;
}

/*
|--------------------------------------------------------------------------
| 2. Validate request method
|--------------------------------------------------------------------------
*/

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {

    header('Allow: GET');

    respond(405, [
        'success' => false,
        'message' => 'Only GET requests are allowed.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 3. Start Institute Admin session
|--------------------------------------------------------------------------
*/

if (session_status() !== PHP_SESSION_ACTIVE) {

    session_name('foundev_institute_admin_sid');

    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS'])
            && strtolower((string) $_SERVER['HTTPS']) !== 'off',
        'httponly' => true,
        'samesite' => 'Lax'
    ]);

    session_start();
}

/*
|--------------------------------------------------------------------------
| 4. Authenticate Institute Admin
|--------------------------------------------------------------------------
*/

$adminId = filter_var(
    $_SESSION['institute_admin_id'] ?? null,
    FILTER_VALIDATE_INT,
    ['options' => ['min_range' => 1]]
);

$applicationId = filter_var(
    $_SESSION['institute_application_id'] ?? null,
    FILTER_VALIDATE_INT,
    ['options' => ['min_range' => 1]]
);

if (
    ($_SESSION['authenticated'] ?? false) !== true
    || ($_SESSION['account_type'] ?? '') !== 'institute_admin'
    || $adminId === false
    || $adminId === null
    || $applicationId === false
    || $applicationId === null
) {

    respond(401, [
        'success' => false,
        'message' => 'Your session has expired. Please log in again.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 5. Automatically locate database configuration
|--------------------------------------------------------------------------
*/

try {

    $currentDir = __DIR__;
    $dbFile = null;

    for ($i = 0; $i < 10; $i++) {

        $candidate = $currentDir
            . DIRECTORY_SEPARATOR
            . 'backend'
            . DIRECTORY_SEPARATOR
            . 'config'
            . DIRECTORY_SEPARATOR
            . 'db.php';

        if (is_file($candidate)) {
            $dbFile = $candidate;
            break;
        }

        $parentDir = dirname($currentDir);

        if ($parentDir === $currentDir) {
            break;
        }

        $currentDir = $parentDir;
    }

    if ($dbFile === null) {

        error_log(
            '[Foundev My Projects] Database file not found. '
            . 'API directory: ' . __DIR__
        );

        respond(500, [
            'success' => false,
            'message' => 'Database configuration could not be loaded.'
        ]);
    }

    require_once $dbFile;

    if (!isset($pdo) || !($pdo instanceof PDO)) {

        throw new RuntimeException(
            'PDO connection was not initialized.'
        );
    }

    /*
    |--------------------------------------------------------------------------
    | 6. Fetch paid purchases with active assignment
    |--------------------------------------------------------------------------
    */

    $sql = "
        SELECT
            po.id AS purchase_id,
            po.order_reference,
            po.project_id,
            po.team_name,
            po.amount,
            po.currency,
            po.payment_status,
            po.payment_verified_at,
            po.created_at AS purchased_at,
            po.access_starts_at,
            po.access_expires_at,

            pc.title,
            pc.description,
            pc.domain,
            pc.project_type,
            pc.technologies,
            pc.is_featured,

            CASE
                WHEN po.access_starts_at IS NOT NULL
                 AND po.access_expires_at IS NOT NULL
                 AND po.access_starts_at <= UTC_TIMESTAMP()
                 AND po.access_expires_at > UTC_TIMESTAMP()
                THEN 1
                ELSE 0
            END AS access_active

        FROM project_purchase_orders AS po

        INNER JOIN project_catalogue AS pc
            ON pc.id = po.project_id

        INNER JOIN institute_project_access AS ipa
            ON ipa.project_id = po.project_id
           AND ipa.institution_id = po.institution_id
           AND ipa.is_active = 1

        WHERE po.institution_id = :institution_id
          AND po.payment_status = 'paid'

        ORDER BY
            po.created_at DESC,
            po.id DESC
    ";

    $stmt = $pdo->prepare($sql);

    $stmt->execute([
        'institution_id' => $applicationId
    ]);

    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    /*
    |--------------------------------------------------------------------------
    | 7. Format project records
    |--------------------------------------------------------------------------
    */

    $projects = [];
    $activeCount = 0;
    $expiredCount = 0;

    foreach ($rows as $row) {

        $isActive = (bool) $row['access_active'];

        if ($isActive) {
            $activeCount++;
        } else {
            $expiredCount++;
        }

        $projects[] = [
            'purchase_id' => (int) $row['purchase_id'],

            'order_reference' => $row['order_reference'],

            'project' => [
                'id' => (int) $row['project_id'],
                'title' => $row['title'],
                'description' => $row['description'],
                'domain' => $row['domain'],
                'project_type' => $row['project_type'],
                'technologies' => $row['technologies'],
                'is_featured' => (bool) $row['is_featured']
            ],

            'team_name' => $row['team_name'],

            'payment' => [
                'status' => $row['payment_status'],
                'amount' => (float) $row['amount'],
                'currency' => $row['currency'],
                'verified_at' => $row['payment_verified_at']
            ],

            'access' => [
                'status' => $isActive ? 'active' : 'expired',
                'is_active' => $isActive,
                'starts_at' => $row['access_starts_at'],
                'expires_at' => $row['access_expires_at'],
                'validity_months' => 6
            ],

            'purchased_at' => $row['purchased_at']
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | 8. Return JSON response
    |--------------------------------------------------------------------------
    */

    respond(200, [
        'success' => true,

        'message' => count($projects) > 0
            ? 'Purchased projects loaded successfully.'
            : 'No purchased projects found.',

        'count' => count($projects),
        'active_count' => $activeCount,
        'expired_count' => $expiredCount,
        'projects' => $projects
    ]);

} catch (Throwable $e) {

    error_log(
        '[Foundev My Projects API] '
        . get_class($e) . ': '
        . $e->getMessage()
    );

    respond(500, [
        'success' => false,
        'message' => 'Unable to load purchased projects. Check the PHP error log.'
    ]);
}