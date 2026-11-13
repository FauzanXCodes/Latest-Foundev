
<?php

/**
 * Foundev — Verify Single and Bulk Project Payments
 *
 * Single order: FDV + 24 hexadecimal characters
 * Bulk order:   FDVBULK + 20 hexadecimal characters
 *
 * Cashfree is queried directly. Browser payment status is never trusted.
 * Access is activated only after successful server-side verification.
 */


ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Content-Type-Options: nosniff');

function verify_response(int $status, array $data): never
{
    http_response_code($status);

    echo json_encode(
        $data,
        JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    );

    exit;
}

/*
|--------------------------------------------------------------------------
| 1. Validate request
|--------------------------------------------------------------------------
*/

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');

    verify_response(405, [
        'success' => false,
        'message' => 'Only POST requests are allowed.'
    ]);
}

if (
    stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') === false
) {
    verify_response(415, [
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
    verify_response(400, [
        'success' => false,
        'message' => 'Invalid JSON request.'
    ]);
}

if (!is_array($input)) {
    verify_response(400, [
        'success' => false,
        'message' => 'Invalid request.'
    ]);
}

$orderReference = strtoupper(
    trim((string) ($input['order_reference'] ?? ''))
);

$isSingleOrder = (bool) preg_match(
    '/^FDV[A-F0-9]{24}$/',
    $orderReference
);

$isBulkOrder = (bool) preg_match(
    '/^FDVBULK[A-F0-9]{20}$/',
    $orderReference
);

if (!$isSingleOrder && !$isBulkOrder) {
    verify_response(422, [
        'success' => false,
        'message' => 'A valid order reference is required.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 2. Load authentication and database
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
    error_log('[Foundev Payment Verify] Required configuration file missing.');

    verify_response(500, [
        'success' => false,
        'message' => 'Payment verification is not configured correctly.'
    ]);
}

require_once $authFile;
require_once $dbFile;

if (
    !isset($pdo) ||
    !$pdo instanceof PDO ||
    !isset($instituteApplicationId)
) {
    verify_response(500, [
        'success' => false,
        'message' => 'Database connection unavailable.'
    ]);
}

$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

/*
|--------------------------------------------------------------------------
| 3. Load shared Cashfree configuration
|--------------------------------------------------------------------------
*/

try {
    $cashfreeConfig = require $cashfreeLoader;

    $appId = $cashfreeConfig['app_id'];
    $secret = $cashfreeConfig['secret_key'];
    $baseUrl = $cashfreeConfig['base_url'];

} catch (Throwable $e) {
    error_log(
        '[Foundev Payment Verify] Cashfree configuration error: ' .
        $e->getMessage()
    );

    verify_response(503, [
        'success' => false,
        'message' => 'Online payments are not configured.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 4. Cashfree GET helper
|--------------------------------------------------------------------------
*/

function cashfree_get(
    string $url,
    string $appId,
    string $secret
): array {
    $ch = curl_init($url);

    if ($ch === false) {
        throw new RuntimeException(
            'Unable to initialize Cashfree connection.'
        );
    }

    curl_setopt_array($ch, [
        CURLOPT_HTTPGET => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,

        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'x-api-version: 2023-08-01',
            'x-client-id: ' . $appId,
            'x-client-secret: ' . $secret
        ]
    ]);

    $body = curl_exec($ch);
    $error = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);

    curl_close($ch);

    if ($body === false || $status < 200 || $status >= 300) {
        error_log(
            '[Foundev Cashfree] GET failed. HTTP=' .
            $status . '; cURL=' . $error .
            '; response=' . substr((string) $body, 0, 1000)
        );

        throw new RuntimeException(
            'Cashfree verification request failed.'
        );
    }

    $data = json_decode(
        (string) $body,
        true,
        512,
        JSON_THROW_ON_ERROR
    );

    if (!is_array($data)) {
        throw new RuntimeException(
            'Invalid Cashfree response.'
        );
    }

    return $data;
}

/*
|--------------------------------------------------------------------------
| 5. Find local order belonging to the authenticated institution
|--------------------------------------------------------------------------
*/

try {
    if ($isSingleOrder) {
        $stmt = $pdo->prepare(
            "SELECT
                id,
                order_reference,
                cashfree_order_id,
                cashfree_payment_id,
                project_id,
                institution_id,
                amount,
                currency,
                payment_status,
                access_starts_at,
                access_expires_at
             FROM project_purchase_orders
             WHERE order_reference = :reference
               AND institution_id = :institution_id
             LIMIT 1"
        );
    } else {
        $stmt = $pdo->prepare(
            "SELECT
                id,
                order_reference,
                cashfree_order_id,
                cashfree_payment_id,
                institution_id,
                amount,
                currency,
                payment_status,
                payment_verified_at
             FROM project_bulk_purchase_orders
             WHERE order_reference = :reference
               AND institution_id = :institution_id
             LIMIT 1"
        );
    }

    $stmt->execute([
        'reference' => $orderReference,
        'institution_id' => $instituteApplicationId
    ]);

    $order = $stmt->fetch();

} catch (Throwable $e) {
    error_log(
        '[Foundev Payment Verify] Order lookup failed: ' .
        $e->getMessage()
    );

    verify_response(500, [
        'success' => false,
        'message' => 'Unable to look up this purchase.'
    ]);
}

if (!$order) {
    verify_response(404, [
        'success' => false,
        'message' => 'Purchase order not found.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 6. Return if already paid
|--------------------------------------------------------------------------
*/

if (strtolower((string) $order['payment_status']) === 'paid') {
    verify_response(200, [
        'success' => true,
        'paid' => true,
        'already_verified' => true,
        'purchase_type' => $isBulkOrder ? 'bulk' : 'single',
        'order_reference' => $orderReference,
        'project_id' => $isSingleOrder
            ? (int) $order['project_id']
            : null,
        'access_expires_at' => $isSingleOrder
            ? $order['access_expires_at']
            : null,
        'message' => 'This purchase has already been verified.'
    ]);
}

if (strtolower((string) $order['payment_status']) !== 'pending') {
    verify_response(409, [
        'success' => false,
        'message' => 'This order is no longer pending.'
    ]);
}

if (empty($order['cashfree_order_id'])) {
    verify_response(409, [
        'success' => false,
        'message' => 'The Cashfree order has not been linked yet.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 7. Verify order directly with Cashfree
|--------------------------------------------------------------------------
*/

try {
    $cashfreeOrder = cashfree_get(
        $baseUrl . '/orders/' . rawurlencode($orderReference),
        $appId,
        $secret
    );

    $cashfreePayments = cashfree_get(
        $baseUrl . '/orders/' .
        rawurlencode($orderReference) . '/payments',
        $appId,
        $secret
    );

} catch (Throwable $e) {
    error_log(
        '[Foundev Payment Verify] Cashfree request error: ' .
        $e->getMessage()
    );

    verify_response(502, [
        'success' => false,
        'message' => 'We could not verify the payment right now. Please retry shortly.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 8. Verify Cashfree order identity, status, amount and currency
|--------------------------------------------------------------------------
*/

$expectedAmount = (float) $order['amount'];

$remoteAmount = (float) (
    $cashfreeOrder['order_amount'] ?? -1
);

$expectedCurrency = strtoupper(
    (string) $order['currency']
);

$remoteCurrency = strtoupper(
    (string) ($cashfreeOrder['order_currency'] ?? '')
);

$remoteStatus = strtoupper(
    (string) ($cashfreeOrder['order_status'] ?? '')
);

$remoteReference = strtoupper(
    trim((string) ($cashfreeOrder['order_id'] ?? ''))
);

$remoteCashfreeOrderId = trim(
    (string) ($cashfreeOrder['cf_order_id'] ?? '')
);

if (
    $remoteReference !== $orderReference ||
    $remoteCashfreeOrderId === '' ||
    $remoteCashfreeOrderId !== (string) $order['cashfree_order_id']
) {
    error_log(
        '[Foundev Payment Verify] Cashfree order identity mismatch for ' .
        $orderReference
    );

    verify_response(502, [
        'success' => false,
        'message' => 'The payment provider returned an unexpected order reference.'
    ]);
}

if (
    $remoteStatus !== 'PAID' ||
    $remoteCurrency !== $expectedCurrency ||
    abs($remoteAmount - $expectedAmount) > 0.001
) {
    verify_response(200, [
        'success' => true,
        'paid' => false,
        'purchase_type' => $isBulkOrder ? 'bulk' : 'single',
        'order_reference' => $orderReference,
        'message' => 'Payment is not confirmed yet. Please retry shortly.'
    ]);
}

if (!array_is_list($cashfreePayments)) {
    verify_response(502, [
        'success' => false,
        'message' => 'Unexpected payment verification response.'
    ]);
}

/*
|--------------------------------------------------------------------------
| 9. Find a successful payment matching the order amount and currency
|--------------------------------------------------------------------------
*/

$successfulPayment = null;

foreach ($cashfreePayments as $payment) {
    if (!is_array($payment)) {
        continue;
    }

    $paymentStatus = strtoupper(
        (string) ($payment['payment_status'] ?? '')
    );

    $paymentAmount = (float) (
        $payment['payment_amount'] ?? -1
    );

    $paymentCurrency = strtoupper(
        (string) ($payment['payment_currency'] ?? '')
    );

    if (
        $paymentStatus === 'SUCCESS' &&
        abs($paymentAmount - $expectedAmount) <= 0.001 &&
        $paymentCurrency === $expectedCurrency
    ) {
        $successfulPayment = $payment;
        break;
    }
}

if ($successfulPayment === null) {
    verify_response(200, [
        'success' => true,
        'paid' => false,
        'purchase_type' => $isBulkOrder ? 'bulk' : 'single',
        'order_reference' => $orderReference,
        'message' => 'No successful matching payment was found yet.'
    ]);
}

$paymentId = trim(
    (string) ($successfulPayment['cf_payment_id'] ?? '')
);

if ($paymentId === '') {
    verify_response(502, [
        'success' => false,
        'message' => 'Cashfree did not return a payment ID.'
    ]);
}

$paymentMethod = substr(
    (string) (
        $successfulPayment['payment_group'] ??
        $successfulPayment['payment_method'] ??
        ''
    ),
    0,
    60
);

/*
|--------------------------------------------------------------------------
| 10. Atomically activate the purchase
|--------------------------------------------------------------------------
*/

try {
    $pdo->beginTransaction();

    /*
    |--------------------------------------------------------------------------
    | Lock the relevant local order
    |--------------------------------------------------------------------------
    */

    if ($isSingleOrder) {
        $lockStmt = $pdo->prepare(
            "SELECT id, payment_status
             FROM project_purchase_orders
             WHERE id = :id
               AND institution_id = :institution_id
             FOR UPDATE"
        );
    } else {
        $lockStmt = $pdo->prepare(
            "SELECT id, payment_status
             FROM project_bulk_purchase_orders
             WHERE id = :id
               AND institution_id = :institution_id
             FOR UPDATE"
        );
    }

    $lockStmt->execute([
        'id' => (int) $order['id'],
        'institution_id' => $instituteApplicationId
    ]);

    $lockedOrder = $lockStmt->fetch();

    if (!$lockedOrder) {
        throw new RuntimeException(
            'Order could not be locked.'
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Prevent duplicate activation
    |--------------------------------------------------------------------------
    */

    if (strtolower((string) $lockedOrder['payment_status']) === 'paid') {
        $pdo->commit();

        verify_response(200, [
            'success' => true,
            'paid' => true,
            'already_verified' => true,
            'purchase_type' => $isBulkOrder ? 'bulk' : 'single',
            'order_reference' => $orderReference,
            'message' => 'Payment was already verified.'
        ]);
    }

    if (strtolower((string) $lockedOrder['payment_status']) !== 'pending') {
        throw new DomainException(
            'This order is no longer pending.'
        );
    }

    /*
    |--------------------------------------------------------------------------
    | 11. SINGLE PROJECT PURCHASE
    |--------------------------------------------------------------------------
    */

    if ($isSingleOrder) {
        $update = $pdo->prepare(
            "UPDATE project_purchase_orders
             SET payment_status = 'paid',
                 cashfree_payment_id = :payment_id,
                 cashfree_payment_method = :payment_method,
                 payment_verified_at = UTC_TIMESTAMP(),
                 access_starts_at = UTC_TIMESTAMP(),
                 access_expires_at = DATE_ADD(
                     UTC_TIMESTAMP(),
                     INTERVAL 6 MONTH
                 )
             WHERE id = :id
               AND institution_id = :institution_id
               AND payment_status = 'pending'"
        );

        $update->execute([
            'payment_id' => $paymentId,
            'payment_method' => $paymentMethod !== ''
                ? $paymentMethod
                : null,
            'id' => (int) $order['id'],
            'institution_id' => $instituteApplicationId
        ]);

        if ($update->rowCount() !== 1) {
            throw new RuntimeException(
                'Single purchase activation failed.'
            );
        }

        $expiryStmt = $pdo->prepare(
            "SELECT access_expires_at
             FROM project_purchase_orders
             WHERE id = :id"
        );

        $expiryStmt->execute([
            'id' => (int) $order['id']
        ]);

        $expiresAt = $expiryStmt->fetchColumn();

        $pdo->commit();

        verify_response(200, [
            'success' => true,
            'paid' => true,
            'purchase_type' => 'single',
            'order_reference' => $orderReference,
            'project_id' => (int) $order['project_id'],
            'access_expires_at' => $expiresAt,
            'message' => 'Payment verified. Your selected team purchase is active.'
        ]);
    }

    /*
    |--------------------------------------------------------------------------
    | 12. BULK PROJECT PURCHASE
    |--------------------------------------------------------------------------
    */

    $itemsStmt = $pdo->prepare(
        "SELECT project_id
         FROM project_bulk_purchase_order_items
         WHERE bulk_order_id = :bulk_order_id
         FOR UPDATE"
    );

    $itemsStmt->execute([
        'bulk_order_id' => (int) $order['id']
    ]);

    $projectIds = $itemsStmt->fetchAll(PDO::FETCH_COLUMN);

    if (count($projectIds) === 0) {
        throw new RuntimeException(
            'Bulk order contains no project items.'
        );
    }

    // Verify saved project count.
    $countStmt = $pdo->prepare(
        "SELECT project_count
         FROM project_bulk_purchase_orders
         WHERE id = :id"
    );

    $countStmt->execute([
        'id' => (int) $order['id']
    ]);

    $expectedCount = (int) $countStmt->fetchColumn();

    if ($expectedCount !== count($projectIds)) {
        throw new RuntimeException(
            'Bulk order project count does not match its items.'
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Mark bulk order paid
    |--------------------------------------------------------------------------
    */

    $bulkUpdate = $pdo->prepare(
        "UPDATE project_bulk_purchase_orders
         SET payment_status = 'paid',
             cashfree_payment_id = :payment_id,
             payment_verified_at = UTC_TIMESTAMP()
         WHERE id = :id
           AND institution_id = :institution_id
           AND payment_status = 'pending'"
    );

    $bulkUpdate->execute([
        'payment_id' => $paymentId,
        'id' => (int) $order['id'],
        'institution_id' => $instituteApplicationId
    ]);

    if ($bulkUpdate->rowCount() !== 1) {
        throw new RuntimeException(
            'Bulk payment status could not be updated.'
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Grant access to every purchased project
    |--------------------------------------------------------------------------
    |
    | Existing access expiry is never shortened.
    |
    */

    $accessStmt = $pdo->prepare(
        "INSERT INTO institute_project_access (
            institution_id,
            project_id,
            is_active,
            access_starts_at,
            access_expires_at,
            source_bulk_order_id
         ) VALUES (
            :institution_id,
            :project_id,
            1,
            UTC_TIMESTAMP(),
            DATE_ADD(UTC_TIMESTAMP(), INTERVAL 6 MONTH),
            :bulk_order_id
         )
         ON DUPLICATE KEY UPDATE
            is_active = 1,
            access_starts_at = UTC_TIMESTAMP(),
            access_expires_at = GREATEST(
                COALESCE(
                    access_expires_at,
                    '1970-01-01 00:00:00'
                ),
                DATE_ADD(UTC_TIMESTAMP(), INTERVAL 6 MONTH)
            ),
            source_bulk_order_id = :update_bulk_order_id"
    );

    foreach ($projectIds as $projectId) {
        $accessStmt->execute([
            'institution_id' => $instituteApplicationId,
            'project_id' => (int) $projectId,
            'bulk_order_id' => (int) $order['id'],
            'update_bulk_order_id' => (int) $order['id']
        ]);
    }

    $pdo->commit();

    verify_response(200, [
        'success' => true,
        'paid' => true,
        'purchase_type' => 'bulk',
        'order_reference' => $orderReference,
        'project_count' => count($projectIds),
        'project_ids' => array_map('intval', $projectIds),
        'message' => 'Payment verified. Bulk project access is now active for your institution.'
    ]);

} catch (DomainException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    verify_response(409, [
        'success' => false,
        'message' => $e->getMessage()
    ]);

} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    error_log(
        '[Foundev Payment Verify] Activation failed: ' .
        get_class($e) . ': ' . $e->getMessage()
    );

    verify_response(500, [
        'success' => false,
        'message' => 'Payment may have succeeded, but access activation failed. Please retry verification.'
    ]);
}
