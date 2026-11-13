
<?php

/*
|--------------------------------------------------------------------------
| Foundev — Create Bulk Project Purchase Order
|--------------------------------------------------------------------------
| File: institute-users/api/admin/create-project-bulk-order.php
|
| Supports:
| - Minimum 15 and maximum 100 projects
| - partner_institution pricing
| - Server-side price calculation
| - One Cashfree Hosted Checkout order
| - Local pending order and order items
|
| Cashfree credentials are loaded from:
| backend/config/cashfree-loader.php
|--------------------------------------------------------------------------
*/

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

const MIN_PARTNER_PROJECTS = 15;
const MAX_BULK_PROJECTS = 100;

function bulk_response(int $status, array $payload): never
{
    http_response_code($status);

    echo json_encode(
        $payload,
        JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    );

    exit;
}

function bulk_clean(mixed $value): string
{
    return trim((string) ($value ?? ''));
}

/*
|--------------------------------------------------------------------------
| 1. Request validation
|--------------------------------------------------------------------------
*/

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');

    bulk_response(405, [
        'success' => false,
        'message' => 'Only POST requests are allowed.'
    ]);
}

$contentType = $_SERVER['CONTENT_TYPE'] ?? '';

if (stripos($contentType, 'application/json') === false) {
    bulk_response(415, [
        'success' => false,
        'message' => 'Send the request as JSON.'
    ]);
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
    bulk_response(400, [
        'success' => false,
        'message' => 'Invalid JSON request.'
    ]);
}

if (!is_array($input)) {
    bulk_response(400, [
        'success' => false,
        'message' => 'Invalid request.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 2. Validate selected project IDs
|--------------------------------------------------------------------------
*/

$rawIds = $input['project_ids'] ?? null;

if (!is_array($rawIds)) {
    bulk_response(422, [
        'success' => false,
        'message' => 'Select at least 15 projects.'
    ]);
}

$projectIds = [];

foreach ($rawIds as $rawId) {
    $id = filter_var(
        $rawId,
        FILTER_VALIDATE_INT,
        [
            'options' => [
                'min_range' => 1
            ]
        ]
    );

    if ($id === false) {
        bulk_response(422, [
            'success' => false,
            'message' => 'The selected project list contains an invalid ID.'
        ]);
    }

    $projectIds[] = (int) $id;
}

/* Remove duplicate project IDs. */
$projectIds = array_values(array_unique($projectIds));

if (count($projectIds) < MIN_PARTNER_PROJECTS) {
    bulk_response(422, [
        'success' => false,
        'message' => 'Partner institution checkout requires at least 15 different projects.'
    ]);
}

if (count($projectIds) > MAX_BULK_PROJECTS) {
    bulk_response(422, [
        'success' => false,
        'message' => 'You can purchase up to 100 projects in one order.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 3. Validate customer phone
|--------------------------------------------------------------------------
*/

$customerPhone = bulk_clean(
    $input['customer_phone'] ?? ''
);

if (!preg_match('/^[0-9]{10,15}$/', $customerPhone)) {
    bulk_response(422, [
        'success' => false,
        'message' => 'Enter a valid contact number using 10–15 digits.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 4. Load authentication and database configuration
|--------------------------------------------------------------------------
*/

$root = dirname(__DIR__, 3);

$authFile = $root . '/backend/auth/require-institute-admin.php';
$dbFile = $root . '/backend/config/db.php';
$cashfreeLoader = $root . '/backend/config/cashfree-loader.php';

if (
    !is_file($authFile) ||
    !is_file($dbFile) ||
    !is_file($cashfreeLoader)
) {
    error_log(
        '[Foundev Bulk Purchase] Required configuration file missing.'
    );

    bulk_response(500, [
        'success' => false,
        'message' => 'Purchase service is not configured correctly.'
    ]);
}

require_once $authFile;
require_once $dbFile;

if (!isset($pdo) || !$pdo instanceof PDO) {
    bulk_response(500, [
        'success' => false,
        'message' => 'Database connection unavailable.'
    ]);
}

if (
    !isset($instituteAdminId) ||
    !isset($instituteApplicationId)
) {
    bulk_response(401, [
        'success' => false,
        'message' => 'Administrator authentication is required.'
    ]);
}

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
| 5. Load shared Cashfree configuration
|--------------------------------------------------------------------------
*/

try {
    $cashfreeConfig = require $cashfreeLoader;

    $appId = $cashfreeConfig['app_id'];
    $secret = $cashfreeConfig['secret_key'];
    $environment = $cashfreeConfig['environment'];
    $cashfreeBase = $cashfreeConfig['base_url'];
    $returnBase = $cashfreeConfig['return_url'];
    $webhookUrl = $cashfreeConfig['webhook_url'];

} catch (Throwable $e) {
    error_log(
        '[Foundev Bulk Purchase] Cashfree configuration error: ' .
        $e->getMessage()
    );

    bulk_response(503, [
        'success' => false,
        'message' => 'Online payments are not configured yet.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 6. Validate trusted return and webhook URLs
|--------------------------------------------------------------------------
*/

if (
    $returnBase === '' ||
    !filter_var($returnBase, FILTER_VALIDATE_URL) ||
    !in_array(
        strtolower((string) parse_url($returnBase, PHP_URL_SCHEME)),
        ['http', 'https'],
        true
    )
) {
    bulk_response(503, [
        'success' => false,
        'message' => 'The payment return URL has not been configured.'
    ]);
}

if ($webhookUrl !== '') {
    if (
        !filter_var($webhookUrl, FILTER_VALIDATE_URL) ||
        strtolower((string) parse_url($webhookUrl, PHP_URL_SCHEME)) !== 'https'
    ) {
        bulk_response(503, [
            'success' => false,
            'message' => 'The payment webhook URL is invalid.'
        ]);
    }
}

/*
|--------------------------------------------------------------------------
| 7. Initialize order information
|--------------------------------------------------------------------------
*/

$admin = null;

$orderReference = 'FDVBULK' .
    strtoupper(bin2hex(random_bytes(10)));

$localOrderId = 0;
$totalAmount = 0.0;
$orderItems = [];

/*
|--------------------------------------------------------------------------
| 8. Verify institution and calculate bulk pricing
|--------------------------------------------------------------------------
*/

try {
    $pdo->beginTransaction();

    /*
    |--------------------------------------------------------------------------
    | Verify institute administrator
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
         LIMIT 1
         FOR UPDATE"
    );

    $adminStmt->execute([
        'admin_id' => $instituteAdminId,
        'application_id' => $instituteApplicationId
    ]);

    $admin = $adminStmt->fetch();

    if (
        !$admin ||
        strtolower((string) $admin['account_status']) !== 'active' ||
        strtolower((string) $admin['application_status']) !== 'approved' ||
        empty($admin['email_verified_at']) ||
        strtolower(trim((string) $admin['email'])) !==
            strtolower(trim((string) $admin['official_email']))
    ) {
        throw new DomainException(
            'Your institution administrator account is not eligible to purchase projects.'
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Fetch published projects and active partner pricing
    |--------------------------------------------------------------------------
    |
    | Pricing is calculated on the server.
    | Browser-submitted prices are never trusted.
    |
    */

    $placeholders = implode(
        ',',
        array_fill(0, count($projectIds), '?')
    );

    $projectSql = "
        SELECT
            p.id AS project_id,
            p.title,
            pp.id AS pricing_id,
            pp.price,
            pp.currency
        FROM project_catalogue p
        INNER JOIN project_pricing pp
            ON pp.project_id = p.id
           AND pp.customer_type = 'partner_institution'
           AND pp.is_active = 1
        WHERE p.id IN ($placeholders)
          AND p.status = 'published'
        ORDER BY p.id ASC
        FOR UPDATE
    ";

    $projectStmt = $pdo->prepare($projectSql);
    $projectStmt->execute($projectIds);

    $rows = $projectStmt->fetchAll();

    $projectsById = [];

    foreach ($rows as $row) {
        $projectsById[(int) $row['project_id']] = $row;
    }

    /*
    |--------------------------------------------------------------------------
    | Verify every selected project and calculate total
    |--------------------------------------------------------------------------
    */

    foreach ($projectIds as $projectId) {
        if (!isset($projectsById[$projectId])) {
            throw new DomainException(
                "Project ID {$projectId} is unavailable, unpublished, or has no active partner institution price."
            );
        }

        $row = $projectsById[$projectId];

        $price = (float) $row['price'];

        $currency = strtoupper(
            trim((string) $row['currency'])
        );

        if (
            !is_finite($price) ||
            $price <= 0 ||
            $currency !== 'INR'
        ) {
            throw new DomainException(
                "Project '{$row['title']}' does not have a valid INR partner price."
            );
        }

        $totalAmount += $price;

        $orderItems[] = [
            'project_id' => $projectId,
            'project_title' => (string) $row['title'],
            'pricing_id' => (int) $row['pricing_id'],
            'unit_price' => number_format($price, 2, '.', ''),
            'currency' => $currency
        ];
    }

    $totalAmount = round($totalAmount, 2);

    if (
        !is_finite($totalAmount) ||
        $totalAmount <= 0
    ) {
        throw new DomainException(
            'The calculated order amount is invalid.'
        );
    }

    /*
    |--------------------------------------------------------------------------
    | 9. Create local bulk purchase order
    |--------------------------------------------------------------------------
    */

    $insertOrder = $pdo->prepare(
        "INSERT INTO project_bulk_purchase_orders (
            order_reference,
            institution_id,
            purchaser_type,
            pricing_mode,
            project_count,
            amount,
            currency,
            payment_status
        ) VALUES (
            :order_reference,
            :institution_id,
            'institution',
            'partner_institution',
            :project_count,
            :amount,
            'INR',
            'pending'
        )"
    );

    $insertOrder->execute([
        'order_reference' => $orderReference,
        'institution_id' => $instituteApplicationId,
        'project_count' => count($orderItems),
        'amount' => number_format($totalAmount, 2, '.', '')
    ]);

    $localOrderId = (int) $pdo->lastInsertId();

    /*
    |--------------------------------------------------------------------------
    | 10. Save individual projects in bulk order items
    |--------------------------------------------------------------------------
    */

    $insertItem = $pdo->prepare(
        "INSERT INTO project_bulk_purchase_order_items (
            bulk_order_id,
            project_id,
            project_title_snapshot,
            pricing_id,
            unit_price,
            currency
        ) VALUES (
            :bulk_order_id,
            :project_id,
            :project_title_snapshot,
            :pricing_id,
            :unit_price,
            :currency
        )"
    );

    foreach ($orderItems as $item) {
        $insertItem->execute([
            'bulk_order_id' => $localOrderId,
            'project_id' => $item['project_id'],
            'project_title_snapshot' => $item['project_title'],
            'pricing_id' => $item['pricing_id'],
            'unit_price' => $item['unit_price'],
            'currency' => $item['currency']
        ]);
    }

    $pdo->commit();

} catch (DomainException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    bulk_response(422, [
        'success' => false,
        'message' => $e->getMessage()
    ]);

} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    error_log(
        '[Foundev Bulk Purchase] Local order error: ' .
        get_class($e) . ': ' . $e->getMessage()
    );

    bulk_response(500, [
        'success' => false,
        'message' => 'Unable to create your bulk purchase order.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 11. Configure Cashfree return URL
|--------------------------------------------------------------------------
*/

$separator = str_contains($returnBase, '?')
    ? '&'
    : '?';

$returnUrl = $returnBase . $separator .
    'order_id={order_id}&payment_type=bulk';

/*
|--------------------------------------------------------------------------
| 12. Prepare Cashfree order payload
|--------------------------------------------------------------------------
*/

$payload = [
    'order_id' => $orderReference,
    'order_amount' => $totalAmount,
    'order_currency' => 'INR',

    'customer_details' => [
        'customer_id' => 'FDVADM' . $instituteAdminId,
        'customer_email' => (string) $admin['email'],
        'customer_phone' => $customerPhone
    ],

    'order_meta' => [
        'return_url' => $returnUrl
    ],

    'order_note' => 'Foundev partner institution bulk project purchase'
];

if ($webhookUrl !== '') {
    $payload['order_meta']['notify_url'] = $webhookUrl;
}

/*
|--------------------------------------------------------------------------
| 13. Create Cashfree payment order
|--------------------------------------------------------------------------
*/

try {
    $ch = curl_init($cashfreeBase . '/orders');

    if ($ch === false) {
        throw new RuntimeException(
            'Unable to initialize Cashfree connection.'
        );
    }

    $payloadJson = json_encode(
        $payload,
        JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
    );

    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,

        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json',
            'x-api-version: 2023-08-01',
            'x-client-id: ' . $appId,
            'x-client-secret: ' . $secret,
            'x-idempotency-key: ' . $orderReference
        ],

        CURLOPT_POSTFIELDS => $payloadJson
    ]);

    $responseBody = curl_exec($ch);
    $curlError = curl_error($ch);

    $httpStatus = (int) curl_getinfo(
        $ch,
        CURLINFO_HTTP_CODE
    );

    curl_close($ch);

    if (
        $responseBody === false ||
        $httpStatus < 200 ||
        $httpStatus >= 300
    ) {
        error_log(
            '[Foundev Bulk Purchase] Cashfree failed. HTTP=' .
            $httpStatus .
            '; cURL=' . $curlError .
            '; response=' .
            substr((string) $responseBody, 0, 1000)
        );

        throw new RuntimeException(
            'Cashfree could not create the payment order.'
        );
    }

    $cashfreeOrder = json_decode(
        (string) $responseBody,
        true,
        512,
        JSON_THROW_ON_ERROR
    );

    $cashfreeOrderId = trim((string) (
        $cashfreeOrder['cf_order_id'] ?? ''
    ));

    $paymentSessionId = trim((string) (
        $cashfreeOrder['payment_session_id'] ?? ''
    ));

    if (
        $cashfreeOrderId === '' ||
        $paymentSessionId === ''
    ) {
        throw new RuntimeException(
            'Cashfree did not return a payment session.'
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Save Cashfree order ID locally
    |--------------------------------------------------------------------------
    */

    $updateStmt = $pdo->prepare(
        "UPDATE project_bulk_purchase_orders
         SET cashfree_order_id = :cashfree_order_id
         WHERE id = :id
           AND payment_status = 'pending'"
    );

    $updateStmt->execute([
        'cashfree_order_id' => $cashfreeOrderId,
        'id' => $localOrderId
    ]);

    if ($updateStmt->rowCount() !== 1) {
        throw new RuntimeException(
            'Unable to save the Cashfree order ID.'
        );
    }

} catch (Throwable $e) {
    error_log(
        '[Foundev Bulk Purchase] Cashfree error: ' .
        get_class($e) . ': ' . $e->getMessage()
    );

    bulk_response(502, [
        'success' => false,
        'message' => 'The payment provider could not initialize checkout. Please contact support before retrying.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 14. Return payment session to frontend
|--------------------------------------------------------------------------
|
| Payment is NOT considered successful here.
| The verification API must independently verify payment with Cashfree.
|--------------------------------------------------------------------------
*/

bulk_response(200, [
    'success' => true,

    'message' => 'Bulk payment order created successfully.',

    'order' => [
        'reference' => $orderReference,
        'cashfree_order_id' => $cashfreeOrderId,
        'payment_session_id' => $paymentSessionId,
        'amount' => $totalAmount,
        'currency' => 'INR',
        'project_count' => count($orderItems),

        'projects' => array_map(
            static fn(array $item): array => [
                'project_id' => $item['project_id'],
                'title' => $item['project_title'],
                'amount' => (float) $item['unit_price']
            ],
            $orderItems
        )
    ],

    'cashfree_environment' => $environment
]);
