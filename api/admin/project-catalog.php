
<?php

/**
 * Foundev - Institute Project Catalogue API
 *
 * File:
 * institute-users/admin/api/admin/project-catalog.php
 *
 * Supported:
 * GET ?action=list
 * GET ?action=detail&id=4
 *
 * Adds purchase information:
 * is_purchased
 * purchase_type
 * access_expires_at
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

function sendJson(int $status, array $data): void
{
    http_response_code($status);

    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE |
        JSON_UNESCAPED_SLASHES |
        JSON_INVALID_UTF8_SUBSTITUTE
    );

    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');

    sendJson(405, [
        'success' => false,
        'message' => 'Method not allowed.'
    ]);
}

/*
|--------------------------------------------------------------------------
| SESSION
|--------------------------------------------------------------------------
*/

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_name('foundev_institute_admin_sid');

    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']) &&
                    $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Lax'
    ]);

    session_start();
}

/*
|--------------------------------------------------------------------------
| AUTHENTICATION
|--------------------------------------------------------------------------
*/

$isAuthenticated =
    isset($_SESSION['authenticated']) &&
    $_SESSION['authenticated'] === true &&
    isset($_SESSION['account_type']) &&
    $_SESSION['account_type'] === 'institute_admin' &&
    isset($_SESSION['institute_admin_id']) &&
    filter_var(
        $_SESSION['institute_admin_id'],
        FILTER_VALIDATE_INT
    ) !== false &&
    isset($_SESSION['institute_application_id']) &&
    filter_var(
        $_SESSION['institute_application_id'],
        FILTER_VALIDATE_INT
    ) !== false;

if (!$isAuthenticated) {
    sendJson(401, [
        'success' => false,
        'message' => 'Your session has expired. Please log in again.'
    ]);
}

$adminId = (int) $_SESSION['institute_admin_id'];
$applicationId = (int) $_SESSION['institute_application_id'];

if ($adminId <= 0 || $applicationId <= 0) {
    sendJson(401, [
        'success' => false,
        'message' => 'Invalid institute administrator session.'
    ]);
}

/*
|--------------------------------------------------------------------------
| DATABASE
|--------------------------------------------------------------------------
*/

$pdo = null;
$directory = __DIR__;
$dbConfigFound = false;

for ($i = 0; $i < 10; $i++) {
    $candidate = $directory . '/backend/config/db.php';

    if (is_file($candidate)) {
        require_once $candidate;
        $dbConfigFound = true;
        break;
    }

    $parent = dirname($directory);

    if ($parent === $directory) {
        break;
    }

    $directory = $parent;
}

if (!$dbConfigFound || !($pdo instanceof PDO)) {
    sendJson(500, [
        'success' => false,
        'message' => 'Database configuration could not be loaded.'
    ]);
}

$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

/*
|--------------------------------------------------------------------------
| PROJECT PRICING
|--------------------------------------------------------------------------
*/

function getProjectPricing(PDO $pdo, array $projectIds): array
{
    if (empty($projectIds)) {
        return [];
    }

    $placeholders = implode(
        ',',
        array_fill(0, count($projectIds), '?')
    );

    $pricingSql = "
        SELECT
            id,
            project_id,
            customer_type,
            price,
            currency,
            is_active
        FROM project_pricing
        WHERE project_id IN ($placeholders)
          AND is_active = 1
        ORDER BY id ASC
    ";

    $pricingStmt = $pdo->prepare($pricingSql);
    $pricingStmt->execute($projectIds);

    $pricingRows = $pricingStmt->fetchAll();

    if (empty($pricingRows)) {
        return [];
    }

    $result = [];
    $individualPricingIds = [];

    foreach ($pricingRows as $row) {
        $projectId = (int) $row['project_id'];
        $pricingId = (int) $row['id'];
        $customerType = (string) $row['customer_type'];

        if (!isset($result[$projectId])) {
            $result[$projectId] = [
                'individual' => null,
                'external_institution' => null,
                'partner_institution' => null,
                'tiers' => []
            ];
        }

        $priceData = [
            'pricing_id' => $pricingId,
            'customer_type' => $customerType,
            'price' => (float) $row['price'],
            'currency' => (string) $row['currency']
        ];

        if ($customerType === 'individual') {
            $result[$projectId]['individual'] = $priceData;
            $individualPricingIds[] = $pricingId;

        } elseif ($customerType === 'external_institution') {
            $result[$projectId]['external_institution'] = $priceData;

        } elseif ($customerType === 'partner_institution') {
            $result[$projectId]['partner_institution'] = $priceData;
        }
    }

    if (!empty($individualPricingIds)) {
        $tierPlaceholders = implode(
            ',',
            array_fill(0, count($individualPricingIds), '?')
        );

        $tierSql = "
            SELECT
                id,
                pricing_id,
                team_size,
                price,
                currency,
                is_active
            FROM project_pricing_tiers
            WHERE pricing_id IN ($tierPlaceholders)
              AND is_active = 1
            ORDER BY team_size ASC
        ";

        $tierStmt = $pdo->prepare($tierSql);
        $tierStmt->execute($individualPricingIds);

        $tierRows = $tierStmt->fetchAll();

        $pricingToProject = [];

        foreach ($pricingRows as $row) {
            if ($row['customer_type'] === 'individual') {
                $pricingToProject[(int) $row['id']] =
                    (int) $row['project_id'];
            }
        }

        foreach ($tierRows as $tier) {
            $pricingId = (int) $tier['pricing_id'];
            $teamSize = (int) $tier['team_size'];

            if (!isset($pricingToProject[$pricingId])) {
                continue;
            }

            $projectId = $pricingToProject[$pricingId];

            $result[$projectId]['tiers'][(string) $teamSize] = [
                'tier_id' => (int) $tier['id'],
                'pricing_id' => $pricingId,
                'team_size' => $teamSize,
                'price' => (float) $tier['price'],
                'currency' => (string) $tier['currency']
            ];
        }
    }

    return $result;
}

/*
|--------------------------------------------------------------------------
| PURCHASE INFORMATION
|--------------------------------------------------------------------------
|
| A project is considered purchased when:
|
| 1. A single project purchase order is paid and its access has not expired.
| 2. A bulk purchase order is paid and its access has not expired.
|
| The bulk order's project list is read from:
| project_bulk_purchase_order_items
|
*/

function getProjectPurchases(
    PDO $pdo,
    int $institutionId,
    array $projectIds
): array {

    if (empty($projectIds)) {
        return [];
    }

    $placeholders = implode(
        ',',
        array_fill(0, count($projectIds), '?')
    );

    $sql = "
        SELECT
            purchased.project_id,
            purchased.purchase_type,
            purchased.access_expires_at
        FROM (
            SELECT
                spo.project_id,
                'single' AS purchase_type,
                spo.access_expires_at
            FROM project_purchase_orders spo
            WHERE spo.institution_id = ?
              AND spo.payment_status = 'paid'
              AND spo.project_id IN ($placeholders)
              AND (
                    spo.access_expires_at IS NULL
                    OR spo.access_expires_at > UTC_TIMESTAMP()
              )

            UNION ALL

            SELECT
                item.project_id,
                'bulk' AS purchase_type,
                access.access_expires_at
            FROM project_bulk_purchase_order_items item
            INNER JOIN project_bulk_purchase_orders bulk
                ON bulk.id = item.bulk_order_id
            LEFT JOIN institute_project_access access
                ON access.institution_id = bulk.institution_id
               AND access.project_id = item.project_id
            WHERE bulk.institution_id = ?
              AND bulk.payment_status = 'paid'
              AND item.project_id IN ($placeholders)
              AND (
                    access.access_expires_at IS NULL
                    OR access.access_expires_at > UTC_TIMESTAMP()
              )
        ) purchased
        ORDER BY purchased.access_expires_at DESC
    ";

    $params = array_merge(
        [$institutionId],
        $projectIds,
        [$institutionId],
        $projectIds
    );

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $rows = $stmt->fetchAll();

    $result = [];

    foreach ($rows as $row) {
        $projectId = (int) $row['project_id'];

        if (!isset($result[$projectId])) {
            $result[$projectId] = [
                'is_purchased' => true,
                'purchase_type' => (string) $row['purchase_type'],
                'access_expires_at' => $row['access_expires_at']
            ];
        }
    }

    return $result;
}

/*
|--------------------------------------------------------------------------
| ATTACH PRICING AND PURCHASE INFORMATION
|--------------------------------------------------------------------------
*/

function attachProjectData(
    array $project,
    array $pricingMap,
    array $purchaseMap
): array {

    $projectId = (int) $project['id'];

    $pricing = $pricingMap[$projectId] ?? [
        'individual' => null,
        'external_institution' => null,
        'partner_institution' => null,
        'tiers' => []
    ];

    $tiers = $pricing['tiers'];

    $project['individual_price'] =
        isset($tiers['1']) ? $tiers['1']['price'] : null;

    $project['pair_price'] =
        isset($tiers['2']) ? $tiers['2']['price'] : null;

    $project['team_price'] =
        isset($tiers['3']) ? $tiers['3']['price'] : null;

    $project['external_institution_price'] =
        $pricing['external_institution']['price'] ?? null;

    $project['partner_institution_price'] =
        $pricing['partner_institution']['price'] ?? null;

    $project['pricing'] = [
        'individual' => $pricing['individual'],
        'external_institution' => $pricing['external_institution'],
        'partner_institution' => $pricing['partner_institution'],
        'tiers' => $tiers
    ];

    $project['university_price'] = null;

    $purchase = $purchaseMap[$projectId] ?? null;

    $project['is_purchased'] = $purchase !== null;

    $project['purchase_type'] =
        $purchase['purchase_type'] ?? null;

    $project['access_expires_at'] =
        $purchase['access_expires_at'] ?? null;

    return $project;
}

/*
|--------------------------------------------------------------------------
| MAIN API
|--------------------------------------------------------------------------
*/

try {

    $action = isset($_GET['action'])
        ? strtolower(trim((string) $_GET['action']))
        : 'list';

    if (!in_array($action, ['list', 'detail'], true)) {
        sendJson(400, [
            'success' => false,
            'message' => 'Invalid action. Use list or detail.'
        ]);
    }

    /*
    |--------------------------------------------------------------------------
    | DETAIL
    |--------------------------------------------------------------------------
    */

    if ($action === 'detail') {

        $projectId = filter_input(
            INPUT_GET,
            'id',
            FILTER_VALIDATE_INT
        );

        if (!$projectId || $projectId <= 0) {
            sendJson(400, [
                'success' => false,
                'message' => 'A valid project ID is required.'
            ]);
        }

        $sql = "
            SELECT
                pc.id,
                pc.title,
                pc.description,
                pc.domain,
                pc.project_type,
                pc.technologies,
                pc.is_featured,
                pc.created_at
            FROM project_catalogue pc
            INNER JOIN institute_project_access ipa
                ON ipa.project_id = pc.id
            WHERE pc.id = :project_id
              AND ipa.institution_id = :institution_id
              AND ipa.is_active = 1
              AND (
                    ipa.access_expires_at IS NULL
                    OR ipa.access_expires_at > UTC_TIMESTAMP()
              )
              AND pc.status = 'published'
            LIMIT 1
        ";

        $stmt = $pdo->prepare($sql);

        $stmt->execute([
            ':project_id' => $projectId,
            ':institution_id' => $applicationId
        ]);

        $project = $stmt->fetch();

        if (!$project) {
            sendJson(404, [
                'success' => false,
                'message' => 'Project not found or not assigned to your institution.'
            ]);
        }

        $pricingMap = getProjectPricing($pdo, [$projectId]);

        $purchaseMap = getProjectPurchases(
            $pdo,
            $applicationId,
            [$projectId]
        );

        $project = attachProjectData(
            $project,
            $pricingMap,
            $purchaseMap
        );

        sendJson(200, [
            'success' => true,
            'message' => 'Project details fetched successfully.',
            'project' => $project
        ]);
    }

    /*
    |--------------------------------------------------------------------------
    | LIST
    |--------------------------------------------------------------------------
    */

    $sql = "
        SELECT
            pc.id,
            pc.title,
            pc.description,
            pc.domain,
            pc.project_type,
            pc.technologies,
            pc.is_featured,
            pc.created_at
        FROM project_catalogue pc
        INNER JOIN institute_project_access ipa
            ON ipa.project_id = pc.id
        WHERE ipa.institution_id = :institution_id
          AND ipa.is_active = 1
          AND (
                ipa.access_expires_at IS NULL
                OR ipa.access_expires_at > UTC_TIMESTAMP()
          )
          AND pc.status = 'published'
        ORDER BY
            pc.is_featured DESC,
            pc.created_at DESC
    ";

    $stmt = $pdo->prepare($sql);

    $stmt->execute([
        ':institution_id' => $applicationId
    ]);

    $projects = $stmt->fetchAll();

    if (empty($projects)) {
        sendJson(200, [
            'success' => true,
            'message' => 'No projects are currently assigned to your institution.',
            'total' => 0,
            'projects' => []
        ]);
    }

    $projectIds = array_map(
        static fn(array $project): int => (int) $project['id'],
        $projects
    );

    $pricingMap = getProjectPricing($pdo, $projectIds);

    $purchaseMap = getProjectPurchases(
        $pdo,
        $applicationId,
        $projectIds
    );

    foreach ($projects as &$project) {
        $project = attachProjectData(
            $project,
            $pricingMap,
            $purchaseMap
        );
    }

    unset($project);

    sendJson(200, [
        'success' => true,
        'message' => 'Projects fetched successfully.',
        'total' => count($projects),
        'projects' => $projects
    ]);

} catch (PDOException $e) {

    error_log(
        'Foundev project catalogue database error: ' .
        $e->getMessage()
    );

    sendJson(500, [
        'success' => false,
        'message' => 'A database error occurred while fetching projects.'
    ]);

} catch (Throwable $e) {

    error_log(
        'Foundev project catalogue error: ' .
        $e->getMessage()
    );

    sendJson(500, [
        'success' => false,
        'message' => 'An unexpected error occurred.'
    ]);
}
