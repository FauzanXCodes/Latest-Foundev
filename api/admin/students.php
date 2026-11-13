
<?php

/**
 * Foundev — Institution Purchased Projects API
 *
 * File:
 * institute-users/api/admin/students.php
 *
 * GET:
 *   ?action=list
 *
 * POST JSON:
 *   { "action": "logout" }
 *
 * Returns paid individual and team project purchases
 * belonging to the authenticated institution.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');

/* =========================================================
   JSON RESPONSE
========================================================= */

function students_api_response(
    int $status,
    array $data
): never {
    http_response_code($status);

    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE |
        JSON_UNESCAPED_SLASHES |
        JSON_INVALID_UTF8_SUBSTITUTE
    );

    exit;
}

/* =========================================================
   REQUEST METHOD AND ACTION
========================================================= */

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

$input = [];

if ($method === 'POST') {
    $rawInput = file_get_contents('php://input');

    if ($rawInput !== false && trim($rawInput) !== '') {
        $decoded = json_decode($rawInput, true);

        if (!is_array($decoded)) {
            students_api_response(400, [
                'success' => false,
                'message' => 'Invalid JSON request.'
            ]);
        }

        $input = $decoded;
    }
} elseif ($method !== 'GET') {
    header('Allow: GET, POST');

    students_api_response(405, [
        'success' => false,
        'message' => 'Method not allowed.'
    ]);
}

$action = $method === 'POST'
    ? trim((string) ($input['action'] ?? ''))
    : trim((string) ($_GET['action'] ?? 'list'));

if ($action === '') {
    $action = 'list';
}

/* =========================================================
   LOAD AUTHENTICATION AND DATABASE
========================================================= */

$root = dirname(__DIR__, 3);

$authFile = $root . '/backend/auth/require-institute-admin.php';
$dbFile = $root . '/backend/config/db.php';

if (!is_file($authFile) || !is_file($dbFile)) {
    error_log('[Foundev Students API] Auth or database file missing.');

    students_api_response(500, [
        'success' => false,
        'message' => 'The student service is not configured correctly.'
    ]);
}

/*
 * The authentication helper must establish:
 *
 * $instituteAdminId
 * $instituteApplicationId
 */

try {
    require_once $authFile;
    require_once $dbFile;
} catch (Throwable $e) {
    error_log('[Foundev Students API] Initialization error: ' . $e->getMessage());

    students_api_response(500, [
        'success' => false,
        'message' => 'Unable to initialize the institution service.'
    ]);
}

/* =========================================================
   VERIFY SESSION AND DATABASE
========================================================= */

if (
    !isset($instituteAdminId) ||
    !isset($instituteApplicationId) ||
    (int) $instituteAdminId <= 0 ||
    (int) $instituteApplicationId <= 0
) {
    students_api_response(401, [
        'success' => false,
        'message' => 'Please sign in to your institution account.'
    ]);
}

if (!isset($pdo) || !$pdo instanceof PDO) {
    students_api_response(500, [
        'success' => false,
        'message' => 'Database connection is unavailable.'
    ]);
}

$institutionId = (int) $instituteApplicationId;

$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

/* =========================================================
   LOGOUT
========================================================= */

if ($action === 'logout') {
    if ($method !== 'POST') {
        students_api_response(405, [
            'success' => false,
            'message' => 'Logout requires POST.'
        ]);
    }

    if (session_status() === PHP_SESSION_ACTIVE) {
        $_SESSION = [];

        $cookieParams = session_get_cookie_params();

        if (ini_get('session.use_cookies')) {
            setcookie(
                session_name(),
                '',
                [
                    'expires' => time() - 42000,
                    'path' => $cookieParams['path'] ?: '/',
                    'domain' => $cookieParams['domain'] ?: '',
                    'secure' => (bool) $cookieParams['secure'],
                    'httponly' => (bool) $cookieParams['httponly'],
                    'samesite' => $cookieParams['samesite'] ?? 'Lax'
                ]
            );
        }

        session_destroy();
    }

    students_api_response(200, [
        'success' => true,
        'message' => 'Signed out successfully.'
    ]);
}

/* =========================================================
   SUPPORTED ACTIONS
========================================================= */

if ($action !== 'list') {
    students_api_response(400, [
        'success' => false,
        'message' => 'Unsupported action.'
    ]);
}

if ($method !== 'GET') {
    students_api_response(405, [
        'success' => false,
        'message' => 'The list action requires GET.'
    ]);
}

/* =========================================================
   LOAD INSTITUTION AND ADMIN IDENTITY
========================================================= */

try {
    $identityStmt = $pdo->prepare(
        "SELECT
            app.id AS institution_id,
            COALESCE(
                NULLIF(app.display_name, ''),
                app.official_name
            ) AS institution_name,
            ia.id AS admin_id,
            ia.full_name AS admin_name,
            ia.email AS admin_email
         FROM institute_applications app
         INNER JOIN institute_admins ia
            ON ia.application_id = app.id
         WHERE app.id = :institution_id
           AND ia.id = :admin_id
           AND app.status = 'approved'
           AND ia.account_status = 'active'
         LIMIT 1"
    );

    $identityStmt->execute([
        'institution_id' => $institutionId,
        'admin_id' => (int) $instituteAdminId
    ]);

    $identity = $identityStmt->fetch();

    if (!$identity) {
        students_api_response(403, [
            'success' => false,
            'message' => 'Your institution administrator account is not active.'
        ]);
    }

    /* =====================================================
       LOAD PAID INDIVIDUAL AND TEAM PURCHASES

       One row is returned for each purchased project member.
       LEFT JOIN ensures a purchase still appears if member
       information is missing.
    ===================================================== */

    $purchaseStmt = $pdo->prepare(
        "SELECT
            po.id AS purchase_id,
            po.order_reference,
            po.cashfree_order_id,
            po.cashfree_payment_id,
            po.institution_id,
            po.project_id,
            po.team_size,
            po.customer_type,
            po.team_name,
            po.amount,
            po.currency,
            po.payment_status,
            po.cashfree_payment_method,
            po.payment_verified_at,
            po.access_starts_at,
            po.access_expires_at,
            po.created_at,

            pc.title AS project_name,
            pc.domain AS project_category,

            pom.id AS member_record_id,
            pom.student_id,
            pom.username_snapshot,
            pom.member_position,

            student.username AS current_username,
            student.full_name AS student_full_name,
            student.email AS student_email

         FROM project_purchase_orders po

         INNER JOIN project_catalogue pc
            ON pc.id = po.project_id

         LEFT JOIN project_purchase_order_members pom
            ON pom.purchase_order_id = po.id

         LEFT JOIN institute_students student
            ON student.id = pom.student_id
           AND student.institution_id = po.institution_id

         WHERE po.institution_id = :institution_id
           AND po.payment_status = 'paid'

         ORDER BY
            COALESCE(po.payment_verified_at, po.created_at) DESC,
            po.id DESC,
            pom.member_position ASC"
    );

    $purchaseStmt->execute([
        'institution_id' => $institutionId
    ]);

    $rows = $purchaseStmt->fetchAll();

    /* =====================================================
       GROUP MEMBER ROWS INTO PURCHASE RECORDS
    ===================================================== */

    $purchases = [];

    foreach ($rows as $row) {
        $purchaseId = (int) $row['purchase_id'];

        if (!isset($purchases[$purchaseId])) {
            $expiresAt = $row['access_expires_at'];

            $accessStatus = 'active';

            if (empty($row['access_starts_at'])) {
                $accessStatus = 'pending';
            } elseif (
                !empty($expiresAt) &&
                strtotime((string) $expiresAt) < time()
            ) {
                $accessStatus = 'expired';
            }

            $purchases[$purchaseId] = [
                'id' => $purchaseId,

                'order_reference' => $row['order_reference'],

                'project_id' => (int) $row['project_id'],
                'project_name' => $row['project_name'],
                'project_category' => $row['project_category'],

                'purchase_type' => (
                    (int) $row['team_size'] > 1
                    ? 'team'
                    : 'individual'
                ),

                'customer_type' => $row['customer_type'],

                'team_name' => $row['team_name'],

                'team_size' => (int) $row['team_size'],

                'amount_paid' => (float) $row['amount'],
                'currency' => $row['currency'],

                'payment_status' => $row['payment_status'],

                'payment_reference' => $row['cashfree_payment_id'],

                'cashfree_payment_id' => $row['cashfree_payment_id'],

                'payment_method' => $row['cashfree_payment_method'],

                'paid_at' => $row['payment_verified_at'],

                'payment_verified_at' => $row['payment_verified_at'],

                'access_status' => $accessStatus,

                'access_starts_at' => $row['access_starts_at'],

                'access_expires_at' => $row['access_expires_at'],

                'created_at' => $row['created_at'],

                'members' => []
            ];
        }

        /*
         * A purchase can have no member rows if its checkout
         * was created before member registration was completed.
         */

        if (!empty($row['member_record_id'])) {
            $username = trim(
                (string) (
                    $row['current_username'] ?:
                    $row['username_snapshot']
                )
            );

            $purchases[$purchaseId]['members'][] = [
                'student_id' => (int) $row['student_id'],

                'username' => $username,

                'full_name' => $row['student_full_name'],

                'email' => $row['student_email'],

                'member_position' => (int) $row['member_position']
            ];
        }
    }

    /* =====================================================
       RESPONSE
    ===================================================== */

    students_api_response(200, [
        'success' => true,
        'message' => 'Purchased projects loaded successfully.',

        'data' => [
            'institution' => [
                'id' => (int) $identity['institution_id'],
                'name' => $identity['institution_name']
            ],

            'administrator' => [
                'id' => (int) $identity['admin_id'],
                'name' => $identity['admin_name'],
                'email' => $identity['admin_email']
            ],

            'purchases' => array_values($purchases),

            'total_purchases' => count($purchases)
        ]
    ]);

} catch (Throwable $e) {
    error_log(
        '[Foundev Students API] Database error: ' . $e->getMessage()
    );

    students_api_response(500, [
        'success' => false,
        'message' => 'Unable to load purchased projects. Please try again.'
    ]);
}
