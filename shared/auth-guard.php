
<?php
/**
 * Foundev — Institution Portal Authentication Guard
 * File: institute-users/shared/auth-guard.php
 */

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

function foundev_start_institute_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        if (session_name() !== 'foundev_institute_admin_sid') {
            http_response_code(403);
            exit('Invalid institution session.');
        }

        return;
    }

    session_name('foundev_institute_admin_sid');

    $isHttps = isset($_SERVER['HTTPS'])
        && $_SERVER['HTTPS'] !== ''
        && strtolower($_SERVER['HTTPS']) !== 'off';

    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $isHttps,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);

    if (!session_start()) {
        http_response_code(500);
        exit('Unable to start your session. Please try again.');
    }
}

function require_institute_role(string $role): void
{
    if ($role !== 'institute_admin') {
        http_response_code(403);
        exit('You are not authorized to access this area.');
    }

    foundev_start_institute_session();

    $authenticated =
        ($_SESSION['authenticated'] ?? false) === true
        && ($_SESSION['account_type'] ?? '') === 'institute_admin'
        && !empty($_SESSION['institute_admin_id'])
        && !empty($_SESSION['institute_application_id']);

    if (!$authenticated) {
        header('Location: ../../pages/institute-admin-login.html');
        exit;
    }
}
