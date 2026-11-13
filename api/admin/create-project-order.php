
<?php

/**
 * Foundev — Create Single Project Purchase Order
 *
 * Supports:
 * - One project per order
 * - Team sizes 1, 2 or 3
 * - Individual project pricing and team-size tiers
 * - Active student and institution validation
 * - Cashfree Hosted Checkout
 *
 * Project access is NOT granted here.
 * It is granted only by successful server-side payment verification.
 */


ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

function order_response(int $status, array $data): never
{
    http_response_code($status);
    echo json_encode(
        $data,
        JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

function clean_string(mixed $value): string
{
    return trim((string) ($value ?? ''));
}

/*
|--------------------------------------------------------------------------
| 1. Validate request
|--------------------------------------------------------------------------
*/

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    order_response(405, [
        'success' => false,
        'message' => 'Only POST requests are allowed.'
    ]);
}

if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') === false) {
    order_response(415, [
        'success' => false,
        'message' => 'Send the request as JSON.'
    ]);
}

try {
    $input = json_decode(
        (string) file_get_contents('php://input'),
        true,
        512,
        JSON_THROW_ON_ERROR
    );
} catch (Throwable $e) {
    order_response(400, [
        'success' => false,
        'message' => 'Invalid JSON request.'
    ]);
}

if (!is_array($input)) {
    order_response(400, [
        'success' => false,
        'message' => 'Invalid request.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 2. Validate project and team details
|--------------------------------------------------------------------------
*/

$projectId = filter_var(
    $input['project_id'] ?? null,
    FILTER_VALIDATE_INT,
    ['options' => ['min_range' => 1]]
);

if ($projectId === false || $projectId === null) {
    $projectIds = $input['project_ids'] ?? [];

    if (!is_array($projectIds) || count($projectIds) !== 1) {
        order_response(422, [
            'success' => false,
            'message' => 'Single checkout requires exactly one project. Use bulk checkout for multiple projects.'
        ]);
    }

    $projectId = filter_var(
        $projectIds[0],
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1]]
    );
}

if ($projectId === false || $projectId === null) {
    order_response(422, [
        'success' => false,
        'message' => 'Select a valid project.'
    ]);
}

$teamSize = filter_var(
    $input['team_size'] ?? null,
    FILTER_VALIDATE_INT
);

if (!in_array($teamSize, [1, 2, 3], true)) {
    order_response(422, [
        'success' => false,
        'message' => 'Select a valid team size.'
    ]);
}

$teamName = clean_string($input['team_name'] ?? '');
$customerPhone = clean_string($input['customer_phone'] ?? '');
$studentUsernames = $input['student_usernames'] ?? [];

if (!is_array($studentUsernames)) {
    order_response(422, [
        'success' => false,
        'message' => 'Invalid student username list.'
    ]);
}

$studentUsernames = array_map(
    static fn($username): string => clean_string($username),
    $studentUsernames
);

if (count($studentUsernames) !== $teamSize) {
    order_response(422, [
        'success' => false,
        'message' => "Enter exactly {$teamSize} student username(s)."
    ]);
}

if (
    $teamSize > 1 &&
    (
        $teamName === '' ||
        mb_strlen($teamName) > 150 ||
        preg_match('/[\x00-\x1F\x7F]/u', $teamName)
    )
) {
    order_response(422, [
        'success' => false,
        'message' => 'Enter a valid team name (maximum 150 characters).'
    ]);
}

if (
    $teamName !== '' &&
    (
        mb_strlen($teamName) > 150 ||
        preg_match('/[\x00-\x1F\x7F]/u', $teamName)
    )
) {
    order_response(422, [
        'success' => false,
        'message' => 'Team name cannot exceed 150 characters.'
    ]);
}

if (!preg_match('/^[0-9]{10,15}$/', $customerPhone)) {
    order_response(422, [
        'success' => false,
        'message' => 'Enter a valid contact number using 10–15 digits.'
    ]);
}

$normalizedUsernames = [];

foreach ($studentUsernames as $username) {
    if (
        $username === '' ||
        mb_strlen($username) > 50 ||
        preg_match('/[\x00-\x20\x7F]/u', $username)
    ) {
        order_response(422, [
            'success' => false,
            'message' => 'One or more student usernames are invalid.'
        ]);
    }

    $normalizedUsernames[] = mb_strtolower($username);
}

if (count(array_unique($normalizedUsernames)) !== $teamSize) {
    order_response(422, [
        'success' => false,
        'message' => 'Each team member must have a different username.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 3. Load authentication, database and Cashfree configuration
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
    error_log('[Foundev Single Purchase] Required configuration file missing.');

    order_response(500, [
        'success' => false,
        'message' => 'Purchase service is not configured correctly.'
    ]);
}

require_once $authFile;
require_once $dbFile;

if (!isset($pdo) || !$pdo instanceof PDO) {
    order_response(500, [
        'success' => false,
        'message' => 'Database connection unavailable.'
    ]);
}

if (
    !isset($instituteAdminId) ||
    !isset($instituteApplicationId)
) {
    order_response(401, [
        'success' => false,
        'message' => 'Administrator authentication is required.'
    ]);
}

$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

try {
    $cashfreeConfig = require $cashfreeLoader;

    $cashfreeAppId = $cashfreeConfig['app_id'];
    $cashfreeSecret = $cashfreeConfig['secret_key'];
    $cashfreeEnvironment = $cashfreeConfig['environment'];
    $cashfreeBaseUrl = $cashfreeConfig['base_url'];
    $returnBase = $cashfreeConfig['return_url'];
    $webhookUrl = $cashfreeConfig['webhook_url'];

} catch (Throwable $e) {
    error_log(
        '[Foundev Single Purchase] Cashfree configuration error: ' .
        $e->getMessage()
    );

    order_response(503, [
        'success' => false,
        'message' => 'Online payments are not configured yet.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 4. Validate return URL
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
    order_response(503, [
        'success' => false,
        'message' => 'The payment return URL has not been configured.'
    ]);
}

if ($webhookUrl !== '') {
    if (
        !filter_var($webhookUrl, FILTER_VALIDATE_URL) ||
        strtolower((string) parse_url($webhookUrl, PHP_URL_SCHEME)) !== 'https'
    ) {
        order_response(503, [
            'success' => false,
            'message' => 'The payment webhook URL is invalid.'
        ]);
    }
}

/*
|--------------------------------------------------------------------------
| 5. Verify institution, project, pricing and students
|--------------------------------------------------------------------------
*/

try {
    $pdo->beginTransaction();

    // Verify institution administrator and approved institution.
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

    if (!$admin) {
        throw new DomainException(
            'Institution administrator account could not be verified.'
        );
    }

    if (
        strtolower((string) $admin['account_status']) !== 'active' ||
        strtolower((string) $admin['application_status']) !== 'approved' ||
        empty($admin['email_verified_at']) ||
        strtolower(trim((string) $admin['email'])) !==
            strtolower(trim((string) $admin['official_email']))
    ) {
        throw new DomainException(
            'Your institution is not eligible to purchase projects.'
        );
    }

    // Verify published project.
    $projectStmt = $pdo->prepare(
        "SELECT id, title, status
         FROM project_catalogue
         WHERE id = :project_id
           AND status = 'published'
         LIMIT 1
         FOR UPDATE"
    );

    $projectStmt->execute([
        'project_id' => $projectId
    ]);

    $project = $projectStmt->fetch();

    if (!$project) {
        throw new DomainException(
            'This project is unavailable or no longer published.'
        );
    }

    // Retrieve individual pricing and selected team-size tier.
    $pricingStmt = $pdo->prepare(
        "SELECT
            pp.id AS pricing_id,
            pp.currency AS pricing_currency,
            ppt.id AS pricing_tier_id,
            ppt.team_size,
            ppt.price AS tier_price,
            ppt.currency AS tier_currency
         FROM project_pricing pp
         INNER JOIN project_pricing_tiers ppt
            ON ppt.pricing_id = pp.id
         WHERE pp.project_id = :project_id
           AND pp.customer_type = 'individual'
           AND pp.is_active = 1
           AND ppt.team_size = :team_size
           AND ppt.is_active = 1
         ORDER BY pp.id DESC
         LIMIT 1
         FOR UPDATE"
    );

    $pricingStmt->execute([
        'project_id' => $projectId,
        'team_size' => $teamSize
    ]);

    $pricing = $pricingStmt->fetch();

    if (!$pricing) {
        throw new DomainException(
            'Pricing is not configured for this project and team size.'
        );
    }

    $amount = (float) $pricing['tier_price'];

    $currency = strtoupper(trim((string) (
        $pricing['tier_currency'] ?:
        $pricing['pricing_currency'] ?:
        'INR'
    )));

    if (
        !is_finite($amount) ||
        $amount <= 0 ||
        $currency !== 'INR'
    ) {
        throw new DomainException(
            'The selected project does not have a valid INR purchase price.'
        );
    }

    // Verify active students belonging to this institution.
    $placeholders = [];
    $studentParameters = [
        'institution_id' => $instituteApplicationId
    ];

    foreach ($studentUsernames as $index => $username) {
        $placeholder = 'username_' . $index;
        $placeholders[] = ':' . $placeholder;
        $studentParameters[$placeholder] = $username;
    }

    $studentSql = "
        SELECT id, username, institution_id, account_status
        FROM institute_students
        WHERE institution_id = :institution_id
          AND account_status = 'active'
          AND username IN (" . implode(', ', $placeholders) . ")
        FOR UPDATE
    ";

    $studentStmt = $pdo->prepare($studentSql);
    $studentStmt->execute($studentParameters);

    $studentRows = $studentStmt->fetchAll();

    $studentsByUsername = [];

    foreach ($studentRows as $student) {
        $key = mb_strtolower(trim((string) $student['username']));
        $studentsByUsername[$key] = $student;
    }

    $verifiedStudents = [];

    foreach ($studentUsernames as $username) {
        $key = mb_strtolower($username);

        if (!isset($studentsByUsername[$key])) {
            throw new DomainException(
                "Student username '{$username}' was not found as an active student in your institution."
            );
        }

        $verifiedStudents[] = $studentsByUsername[$key];
    }

    /*
    |--------------------------------------------------------------------------
    | 6. Create local pending purchase order
    |--------------------------------------------------------------------------
    */

    $orderReference = 'FDV' . strtoupper(bin2hex(random_bytes(12)));

    $insertOrderStmt = $pdo->prepare(
        "INSERT INTO project_purchase_orders (
            order_reference,
            institution_id,
            project_id,
            team_size,
            customer_type,
            pricing_id,
            pricing_tier_id,
            team_name,
            amount,
            currency,
            payment_status
         ) VALUES (
            :order_reference,
            :institution_id,
            :project_id,
            :team_size,
            'individual',
            :pricing_id,
            :pricing_tier_id,
            :team_name,
            :amount,
            :currency,
            'pending'
         )"
    );

    $insertOrderStmt->execute([
        'order_reference' => $orderReference,
        'institution_id' => $instituteApplicationId,
        'project_id' => (int) $project['id'],
        'team_size' => $teamSize,
        'pricing_id' => (int) $pricing['pricing_id'],
        'pricing_tier_id' => (int) $pricing['pricing_tier_id'],
        'team_name' => $teamName !== '' ? $teamName : null,
        'amount' => number_format($amount, 2, '.', ''),
        'currency' => $currency
    ]);

    $localOrderId = (int) $pdo->lastInsertId();

    // Save verified team members.
    $memberStmt = $pdo->prepare(
        "INSERT INTO project_purchase_order_members (
            purchase_order_id,
            student_id,
            username_snapshot,
            member_position
         ) VALUES (
            :purchase_order_id,
            :student_id,
            :username_snapshot,
            :member_position
         )"
    );

    foreach ($verifiedStudents as $index => $student) {
        $memberStmt->execute([
            'purchase_order_id' => $localOrderId,
            'student_id' => (int) $student['id'],
            'username_snapshot' => (string) $student['username'],
            'member_position' => $index + 1
        ]);
    }

    $pdo->commit();

} catch (DomainException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    order_response(422, [
        'success' => false,
        'message' => $e->getMessage()
    ]);

} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    error_log(
        '[Foundev Single Purchase] Local order error: ' .
        get_class($e) . ': ' . $e->getMessage()
    );

    order_response(500, [
        'success' => false,
        'message' => 'Unable to create your purchase order.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 7. Create Cashfree payment order
|--------------------------------------------------------------------------
*/

$customerId = 'FDVADM' . $instituteAdminId;

$returnUrl = $returnBase .
    (str_contains($returnBase, '?') ? '&' : '?') .
    'order_id={order_id}';

$cashfreePayload = [
    'order_id' => $orderReference,
    'order_amount' => round($amount, 2),
    'order_currency' => $currency,

    'customer_details' => [
        'customer_id' => $customerId,
        'customer_email' => (string) $admin['email'],
        'customer_phone' => $customerPhone
    ],

    'order_meta' => [
        'return_url' => $returnUrl
    ],

    'order_note' => 'Foundev single project purchase'
];

if ($webhookUrl !== '') {
    $cashfreePayload['order_meta']['notify_url'] = $webhookUrl;
}

try {
    $ch = curl_init($cashfreeBaseUrl . '/orders');

    if ($ch === false) {
        throw new RuntimeException(
            'Unable to initialize Cashfree connection.'
        );
    }

    $payloadJson = json_encode(
        $cashfreePayload,
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
            'x-client-id: ' . $cashfreeAppId,
            'x-client-secret: ' . $cashfreeSecret,
            'x-idempotency-key: ' . $orderReference
        ],

        CURLOPT_POSTFIELDS => $payloadJson
    ]);

    $responseBody = curl_exec($ch);
    $curlError = curl_error($ch);
    $httpStatus = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);

    curl_close($ch);

    if ($responseBody === false || $httpStatus < 200 || $httpStatus >= 300) {
        error_log(
            '[Foundev Single Purchase] Cashfree request failed. ' .
            'HTTP=' . $httpStatus .
            '; cURL=' . $curlError .
            '; response=' . substr((string) $responseBody, 0, 1000)
        );

        throw new RuntimeException(
            'The payment provider could not create an order.'
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

    if ($cashfreeOrderId === '' || $paymentSessionId === '') {
        throw new RuntimeException(
            'Cashfree did not return the required payment session.'
        );
    }

    // Link Cashfree order ID to local pending order.
    $updateStmt = $pdo->prepare(
        "UPDATE project_purchase_orders
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
            'Unable to save the Cashfree order reference.'
        );
    }

} catch (Throwable $e) {
    error_log(
        '[Foundev Single Purchase] Cashfree error: ' .
        get_class($e) . ': ' . $e->getMessage()
    );

    order_response(502, [
        'success' => false,
        'message' => 'The payment provider could not initialize checkout. Please contact support before retrying.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 8. Return payment session to frontend
|--------------------------------------------------------------------------
*/

order_response(200, [
    'success' => true,
    'message' => 'Payment order created successfully.',

    'order' => [
        'reference' => $orderReference,
        'cashfree_order_id' => $cashfreeOrderId,
        'payment_session_id' => $paymentSessionId,
        'amount' => round($amount, 2),
        'currency' => $currency,
        'project_id' => (int) $project['id'],
        'project_title' => (string) $project['title'],
        'team_size' => $teamSize,
        'team_name' => $teamName
    ],

    'cashfree_environment' => $cashfreeEnvironment
]);
