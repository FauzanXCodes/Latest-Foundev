
<?php
/**
 * Foundev — Student My Projects API
 *
 * File:
 * institute-users/api/student/projects.php
 *
 * Method: GET
 *
 * Returns paid projects available to the logged-in student.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');

/* ---------------------------------------------------------
   JSON RESPONSE
--------------------------------------------------------- */

function sendJson(int $status, array $data): never
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

/* ---------------------------------------------------------
   REQUEST METHOD
--------------------------------------------------------- */

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');

    sendJson(405, [
        'success' => false,
        'message' => 'Only GET requests are allowed.'
    ]);
}

/* ---------------------------------------------------------
   STUDENT SESSION
--------------------------------------------------------- */

$isHttps = isset($_SERVER['HTTPS'])
    && $_SERVER['HTTPS'] !== ''
    && strtolower($_SERVER['HTTPS']) !== 'off';

if (session_status() !== PHP_SESSION_ACTIVE) {
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');

    session_name('foundev_student_sid');

    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $isHttps,
        'httponly' => true,
        'samesite' => 'Lax'
    ]);

    if (!session_start()) {
        sendJson(500, [
            'success' => false,
            'message' => 'Unable to start student session.'
        ]);
    }
}

/* ---------------------------------------------------------
   AUTHENTICATION
--------------------------------------------------------- */

$studentId = filter_var(
    $_SESSION['student_id'] ?? null,
    FILTER_VALIDATE_INT
);

$isAuthenticated =
    isset($_SESSION['student_authenticated']) &&
    $_SESSION['student_authenticated'] === true;

if (!$isAuthenticated || !$studentId || $studentId <= 0) {
    sendJson(401, [
        'success' => false,
        'message' => 'Student session expired. Please sign in again.'
    ]);
}

/* ---------------------------------------------------------
   DATABASE CONNECTION
--------------------------------------------------------- */

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
$pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);

/* ---------------------------------------------------------
   FETCH STUDENT
--------------------------------------------------------- */

try {
    $studentStmt = $pdo->prepare("
        SELECT
            id,
            institution_id,
            username,
            full_name,
            email,
            account_status

        FROM institute_students

        WHERE id = :student_id

        LIMIT 1
    ");

    $studentStmt->execute([
        'student_id' => $studentId
    ]);

    $student = $studentStmt->fetch();

    if (
        !$student ||
        strtolower(trim((string) $student['account_status'])) !== 'active'
    ) {
        sendJson(403, [
            'success' => false,
            'message' => 'Your student account is unavailable.'
        ]);
    }

    $institutionId = (int) $student['institution_id'];

    if ($institutionId <= 0) {
        sendJson(403, [
            'success' => false,
            'message' => 'Your student account is not linked to an institution.'
        ]);
    }

    /* -----------------------------------------------------
       INDIVIDUAL PURCHASES

       Only students assigned to the purchase order
       can access these projects.
    ----------------------------------------------------- */

    $singleSql = "
        SELECT
            pc.id,
            pc.title,
            pc.description,
            pc.domain,
            pc.project_type,
            pc.technologies,
            pc.created_at,

            spo.id AS purchase_order_id,
            spo.order_reference,
            spo.team_name,
            spo.team_size,
            spo.created_at AS purchased_at,
            spo.access_starts_at,
            spo.access_expires_at,

            'single' AS purchase_type,

            (
                SELECT COUNT(*)
                FROM project_purchase_order_members all_members
                WHERE all_members.purchase_order_id = spo.id
            ) AS member_count

        FROM project_purchase_order_members member

        INNER JOIN project_purchase_orders spo
            ON spo.id = member.purchase_order_id

        INNER JOIN project_catalogue pc
            ON pc.id = spo.project_id

        WHERE member.student_id = :student_id

          AND spo.institution_id = :institution_id

          AND spo.payment_status = 'paid'

          AND (
              spo.access_starts_at IS NULL
              OR spo.access_starts_at <= UTC_TIMESTAMP()
          )

          AND (
              spo.access_expires_at IS NULL
              OR spo.access_expires_at > UTC_TIMESTAMP()
          )

          AND pc.status = 'published'

        ORDER BY spo.created_at DESC
    ";

    $singleStmt = $pdo->prepare($singleSql);

    $singleStmt->execute([
        'student_id' => $studentId,
        'institution_id' => $institutionId
    ]);

    $singleProjects = $singleStmt->fetchAll();

    /* -----------------------------------------------------
       BULK PURCHASES

       Bulk purchases are institution-wide in this version.
    ----------------------------------------------------- */

    $bulkSql = "
        SELECT
            pc.id,
            pc.title,
            pc.description,
            pc.domain,
            pc.project_type,
            pc.technologies,
            pc.created_at,

            bulk.id AS purchase_order_id,
            bulk.order_reference,

            NULL AS team_name,
            NULL AS team_size,

            bulk.created_at AS purchased_at,

            NULL AS access_starts_at,
            NULL AS access_expires_at,

            'bulk' AS purchase_type,

            0 AS member_count

        FROM project_bulk_purchase_order_items item

        INNER JOIN project_bulk_purchase_orders bulk
            ON bulk.id = item.bulk_order_id

        INNER JOIN project_catalogue pc
            ON pc.id = item.project_id

        WHERE bulk.institution_id = :institution_id

          AND bulk.payment_status = 'paid'

          AND pc.status = 'published'

        ORDER BY bulk.created_at DESC
    ";

    $bulkStmt = $pdo->prepare($bulkSql);

    $bulkStmt->execute([
        'institution_id' => $institutionId
    ]);

    $bulkProjects = $bulkStmt->fetchAll();

    /* -----------------------------------------------------
       MERGE PROJECTS AND REMOVE DUPLICATES
    ----------------------------------------------------- */

    $projectsById = [];

    foreach ($bulkProjects as $project) {
        $projectsById[(int) $project['id']] = $project;
    }

    // Individual assignment takes precedence.
    foreach ($singleProjects as $project) {
        $projectsById[(int) $project['id']] = $project;
    }

    $projects = array_values($projectsById);

    /* -----------------------------------------------------
       NORMALIZE DATA
    ----------------------------------------------------- */

    foreach ($projects as &$project) {
        $project['id'] = (int) $project['id'];
        $project['project_id'] = (int) $project['id'];

        $project['purchase_order_id'] =
            (int) $project['purchase_order_id'];

        $project['team_size'] =
            $project['team_size'] !== null
                ? (int) $project['team_size']
                : null;

        $project['member_count'] = (int) $project['member_count'];

        if ($project['member_count'] === 0) {
            $project['member_count'] = $project['team_size'] ?? 0;
        }

        $project['status'] = 'active';

        $project['team_name'] = $project['team_name'] ?? '';

        $project['category'] = $project['domain']
            ?: ($project['project_type'] ?: 'General');

        $technologies = $project['technologies'] ?? [];

        if (is_string($technologies)) {
            $decoded = json_decode($technologies, true);

            if (is_array($decoded)) {
                $technologies = $decoded;
            } else {
                $technologies = array_filter(
                    array_map(
                        'trim',
                        preg_split('/[,|]/', $technologies)
                    )
                );
            }
        }

        $project['technologies'] = is_array($technologies)
            ? array_values($technologies)
            : [];

        $project['purchase_type'] =
            (string) $project['purchase_type'];
    }

    unset($project);

    /* -----------------------------------------------------
       RESPONSE
    ----------------------------------------------------- */

    sendJson(200, [
        'success' => true,
        'message' => 'Student projects fetched successfully.',

        'student' => [
            'id' => (int) $student['id'],
            'username' => $student['username'],
            'name' => $student['full_name'],
            'email' => $student['email'],
            'institution_id' => $institutionId
        ],

        'projects' => $projects,

        'total' => count($projects)
    ]);

} catch (Throwable $e) {
    error_log(
        '[Foundev Student Projects API] ' . $e->getMessage()
    );

    sendJson(500, [
        'success' => false,
        'message' => 'Unable to load your projects right now.'
    ]);
}
