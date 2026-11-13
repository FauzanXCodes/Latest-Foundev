
<?php

/**
 * Foundev — Institute Student Logout API
 * File: institute-users/api/student/logout.php
 *
 * Method: POST
 * Response: JSON
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');

function logoutResponse($status, $success, $message)
{
    http_response_code($status);

    echo json_encode([
        'success' => $success,
        'message' => $message
    ]);

    exit;
}

/* 1. Only allow POST requests */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');

    logoutResponse(
        405,
        false,
        'Method not allowed.'
    );
}

/* 2. Start the same session used by student login */

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
        logoutResponse(
            500,
            false,
            'Unable to start the session.'
        );
    }
}

/* 3. Clear session data */

$_SESSION = [];

/* 4. Expire the session cookie */

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
            'samesite' => isset($cookie['samesite'])
                ? $cookie['samesite']
                : 'Lax'
        ]
    );
}

/* 5. Destroy the server-side session */

if (!session_destroy()) {
    logoutResponse(
        500,
        false,
        'Unable to complete logout. Please try again.'
    );
}

/* 6. Return success */

logoutResponse(
    200,
    true,
    'You have been signed out successfully.'
);
