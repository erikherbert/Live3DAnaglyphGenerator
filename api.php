<?php
declare(strict_types=1);

// This endpoint stores only WebRTC signaling and heartbeat data, never camera images.
const SIDES = ['a', 'b'];
const ROLES = ['admin', 'camera'];
const CONNECTED_TTL_SECONDS = 8;
const MAX_JSON_BYTES = 262144;
const MAX_SDP_BYTES = 200000;
const MAX_ICE_BYTES = 8192;
const SIGNAL_TTL_SECONDS = 3600;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 900;
const MAX_DATA_JSON_FILES = 1000;

$dataDir = __DIR__ . '/data';
ensure_dir($dataDir);
cleanup_data_dir($dataDir);
enforce_rate_limit($dataDir);

$action = (string)($_GET['action'] ?? '');

try {
    if ($action === 'state') {
        $room = require_room($_GET['room'] ?? '');
        json_response(build_state($dataDir, $room));
    }

    if ($action === 'heartbeat') {
        $payload = read_json_body();
        reject_image_payload($payload);
        $side = normalize_side($payload['side'] ?? '');
        $room = require_room($payload['room'] ?? '');

        write_json_locked($dataDir . '/heartbeat-' . $room . '-' . $side . '.json', [
            'room' => $room,
            'side' => $side,
            'running' => (bool)($payload['running'] ?? false),
            'width' => (int)($payload['width'] ?? 0),
            'height' => (int)($payload['height'] ?? 0),
            'facingMode' => (string)($payload['facingMode'] ?? ''),
            'resolution' => (string)($payload['resolution'] ?? ''),
            'webrtcState' => (string)($payload['webrtcState'] ?? ''),
            'sessionId' => sanitize_session_id((string)($payload['sessionId'] ?? '')),
            'clientTs' => (int)($payload['clientTs'] ?? 0),
            'serverTs' => time_ms(),
        ]);

        json_response(['ok' => true]);
    }

    if ($action === 'signal-reset') {
        $payload = read_json_body(true);
        reject_image_payload($payload);
        $room = require_room($payload['room'] ?? '');
        $side = isset($payload['side']) && $payload['side'] !== ''
            ? normalize_side($payload['side'])
            : null;

        reset_signaling($dataDir, $room, $side);
        json_response(['ok' => true]);
    }

    if ($action === 'signal-offer') {
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $payload = read_json_body();
            reject_image_payload($payload);
            $side = normalize_side($payload['side'] ?? '');
            $room = require_room($payload['room'] ?? '');
            $sessionId = require_session_id($payload['sessionId'] ?? '');
            $description = normalize_description($payload['description'] ?? null, 'offer');

            write_json_locked($dataDir . '/webrtc-offer-' . $room . '-' . $side . '.json', [
                'room' => $room,
                'side' => $side,
                'sessionId' => $sessionId,
                'description' => $description,
                'serverTs' => time_ms(),
            ]);

            clear_file($dataDir . '/webrtc-answer-' . $room . '-' . $side . '.json');
            json_response(['ok' => true]);
        }

        $side = normalize_side($_GET['side'] ?? '');
        $room = require_room($_GET['room'] ?? '');
        json_response([
            'ok' => true,
            'offer' => read_json_file($dataDir . '/webrtc-offer-' . $room . '-' . $side . '.json', null),
        ]);
    }

    if ($action === 'signal-answer') {
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $payload = read_json_body();
            reject_image_payload($payload);
            $side = normalize_side($payload['side'] ?? '');
            $room = require_room($payload['room'] ?? '');
            $sessionId = require_session_id($payload['sessionId'] ?? '');
            $description = normalize_description($payload['description'] ?? null, 'answer');

            write_json_locked($dataDir . '/webrtc-answer-' . $room . '-' . $side . '.json', [
                'room' => $room,
                'side' => $side,
                'sessionId' => $sessionId,
                'description' => $description,
                'serverTs' => time_ms(),
            ]);

            json_response(['ok' => true]);
        }

        $side = normalize_side($_GET['side'] ?? '');
        $room = require_room($_GET['room'] ?? '');
        $sessionId = sanitize_session_id((string)($_GET['sessionId'] ?? ''));
        $answer = read_json_file($dataDir . '/webrtc-answer-' . $room . '-' . $side . '.json', null);
        if ($answer && $sessionId !== '' && ($answer['sessionId'] ?? '') !== $sessionId) {
            $answer = null;
        }

        json_response([
            'ok' => true,
            'answer' => $answer,
        ]);
    }

    if ($action === 'signal-ice') {
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $payload = read_json_body();
            reject_image_payload($payload);
            $side = normalize_side($payload['side'] ?? '');
            $room = require_room($payload['room'] ?? '');
            $target = normalize_role($payload['target'] ?? '');
            $sessionId = require_session_id($payload['sessionId'] ?? '');
            $candidate = normalize_ice_candidate($payload['candidate'] ?? null);

            append_ice_candidate($dataDir, $room, $side, $target, $sessionId, $candidate);
            json_response(['ok' => true]);
        }

        $side = normalize_side($_GET['side'] ?? '');
        $room = require_room($_GET['room'] ?? '');
        $target = normalize_role($_GET['target'] ?? '');
        $sessionId = sanitize_session_id((string)($_GET['sessionId'] ?? ''));
        $after = max(0, (int)($_GET['after'] ?? 0));

        json_response([
            'ok' => true,
            'candidates' => read_ice_candidates($dataDir, $room, $side, $target, $sessionId, $after),
        ]);
    }

    throw new RuntimeException('Unknown API action.', 404);
} catch (Throwable $error) {
    $code = (int)$error->getCode();
    if ($code < 400 || $code > 599) {
        $code = 500;
    }

    json_response([
        'ok' => false,
        'error' => $error->getMessage(),
    ], $code);
}

// Builds the complete admin polling response for one room.
function build_state(string $dataDir, string $room): array
{
    $cameras = [];
    foreach (SIDES as $side) {
        $heartbeat = read_json_file($dataDir . '/heartbeat-' . $room . '-' . $side . '.json', []);
        $lastSeen = (int)($heartbeat['serverTs'] ?? 0);
        $connected = $lastSeen > 0 && (time_ms() - $lastSeen) < CONNECTED_TTL_SECONDS * 1000;

        $cameras[$side] = [
            'side' => $side,
            'connected' => $connected,
            'heartbeat' => $heartbeat,
        ];
    }

    return [
        'ok' => true,
        'room' => $room,
        'serverTs' => time_ms(),
        'cameras' => $cameras,
        'signals' => [
            'a' => signal_summary($dataDir, $room, 'a'),
            'b' => signal_summary($dataDir, $room, 'b'),
        ],
    ];
}

// Reports whether offer/answer signaling data exists for one camera side.
function signal_summary(string $dataDir, string $room, string $side): array
{
    $offer = read_json_file($dataDir . '/webrtc-offer-' . $room . '-' . $side . '.json', null);
    $answer = read_json_file($dataDir . '/webrtc-answer-' . $room . '-' . $side . '.json', null);

    return [
        'hasOffer' => (bool)$offer,
        'hasAnswer' => (bool)$answer,
        'sessionId' => (string)($offer['sessionId'] ?? ''),
        'offerTs' => (int)($offer['serverTs'] ?? 0),
        'answerTs' => (int)($answer['serverTs'] ?? 0),
    ];
}

// Creates a required application directory if it does not exist yet.
function ensure_dir(string $dir): void
{
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        throw new RuntimeException('Could not create folder: ' . $dir);
    }
}

// Removes expired signaling files and caps the number of JSON files in data/.
function cleanup_data_dir(string $dataDir): void
{
    $lock = fopen($dataDir . '/.cleanup.lock', 'c');
    if (!$lock) {
        return;
    }

    if (!flock($lock, LOCK_EX | LOCK_NB)) {
        fclose($lock);
        return;
    }

    try {
        $now = time();
        $files = glob($dataDir . '/*.json') ?: [];

        foreach ($files as $path) {
            $name = basename($path);
            $ttl = str_starts_with($name, 'rate-')
                ? RATE_LIMIT_WINDOW_SECONDS * 3
                : SIGNAL_TTL_SECONDS;
            $mtime = filemtime($path);

            if ($mtime !== false && $mtime < ($now - $ttl)) {
                unlink($path);
            }
        }

        $files = glob($dataDir . '/*.json') ?: [];
        if (count($files) > MAX_DATA_JSON_FILES) {
            usort($files, static function (string $a, string $b): int {
                return (filemtime($a) ?: 0) <=> (filemtime($b) ?: 0);
            });

            foreach (array_slice($files, 0, count($files) - MAX_DATA_JSON_FILES) as $path) {
                unlink($path);
            }
        }
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

// Applies a simple per-client request limit to reduce abuse of the public API.
function enforce_rate_limit(string $dataDir): void
{
    $path = $dataDir . '/rate-' . hash('sha256', client_rate_key()) . '.json';
    $handle = fopen($path, 'c+');
    if (!$handle) {
        throw new RuntimeException('Could not open rate-limit file.');
    }

    try {
        flock($handle, LOCK_EX);
        rewind($handle);
        $raw = stream_get_contents($handle);
        $data = json_decode((string)$raw, true);
        $now = time();

        if (!is_array($data) || (int)($data['windowStart'] ?? 0) <= ($now - RATE_LIMIT_WINDOW_SECONDS)) {
            $data = [
                'windowStart' => $now,
                'count' => 0,
            ];
        }

        $data['count'] = (int)$data['count'] + 1;
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        fflush($handle);

        if ($data['count'] > RATE_LIMIT_MAX_REQUESTS) {
            throw new RuntimeException('Too many API requests. Please wait briefly.', 429);
        }
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

// Returns the client identifier used for rate limiting.
function client_rate_key(): string
{
    return (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

// Reads and validates the JSON request body with a strict size limit.
function read_json_body(bool $allowEmpty = false): array
{
    $raw = (string)file_get_contents('php://input');
    if ($raw === '' && $allowEmpty) {
        return [];
    }

    if (strlen($raw) > MAX_JSON_BYTES) {
        throw new RuntimeException('JSON payload is too large. Image data must not be sent to the server.', 413);
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new RuntimeException('Invalid JSON payload.', 400);
    }

    return $data;
}

// Rejects accidental or malicious data-URL image uploads anywhere in the payload.
function reject_image_payload(mixed $value): void
{
    if (is_string($value)) {
        if (stripos($value, 'data:image/') !== false) {
            throw new RuntimeException('Image data must not be transferred to the server.', 400);
        }
        return;
    }

    if (is_array($value)) {
        foreach ($value as $item) {
            reject_image_payload($item);
        }
    }
}

// Validates and normalizes the camera side identifier.
function normalize_side(mixed $side): string
{
    $side = strtolower((string)$side);
    if (!in_array($side, SIDES, true)) {
        throw new RuntimeException('Invalid camera side.', 400);
    }

    return $side;
}

// Validates and normalizes the WebRTC signaling target role.
function normalize_role(mixed $role): string
{
    $role = strtolower((string)$role);
    if (!in_array($role, ROLES, true)) {
        throw new RuntimeException('Invalid WebRTC role.', 400);
    }

    return $role;
}

// Requires a valid session ID for WebRTC offer/answer/ICE exchange.
function require_session_id(mixed $sessionId): string
{
    $sessionId = sanitize_session_id((string)$sessionId);
    if ($sessionId === '') {
        throw new RuntimeException('Session ID is missing.', 400);
    }

    return $sessionId;
}

// Requires a valid room ID so unrelated camera sessions stay separated.
function require_room(mixed $room): string
{
    $room = sanitize_session_id((string)$room);
    if ($room === '') {
        throw new RuntimeException('Room ID is missing.', 400);
    }

    return $room;
}

// Allows only compact URL-safe IDs before they are used in filenames.
function sanitize_session_id(string $sessionId): string
{
    if (!preg_match('/^[a-zA-Z0-9._-]{1,80}$/', $sessionId)) {
        return '';
    }

    return $sessionId;
}

// Validates a WebRTC session description before storing it.
function normalize_description(mixed $description, string $expectedType): array
{
    if (!is_array($description)) {
        throw new RuntimeException('WebRTC description is missing.', 400);
    }

    $type = (string)($description['type'] ?? '');
    $sdp = (string)($description['sdp'] ?? '');
    if ($type !== $expectedType || $sdp === '' || strlen($sdp) > MAX_SDP_BYTES) {
        throw new RuntimeException('Invalid WebRTC description.', 400);
    }

    return [
        'type' => $type,
        'sdp' => $sdp,
    ];
}

// Validates and keeps only the ICE candidate fields needed by the browser.
function normalize_ice_candidate(mixed $candidate): array
{
    if (!is_array($candidate)) {
        throw new RuntimeException('ICE candidate is missing.', 400);
    }

    $encoded = json_encode($candidate, JSON_UNESCAPED_SLASHES);
    if (!is_string($encoded) || strlen($encoded) > MAX_ICE_BYTES) {
        throw new RuntimeException('ICE candidate is too large.', 400);
    }

    return [
        'candidate' => (string)($candidate['candidate'] ?? ''),
        'sdpMid' => isset($candidate['sdpMid']) ? (string)$candidate['sdpMid'] : null,
        'sdpMLineIndex' => isset($candidate['sdpMLineIndex']) ? (int)$candidate['sdpMLineIndex'] : null,
        'usernameFragment' => isset($candidate['usernameFragment']) ? (string)$candidate['usernameFragment'] : null,
    ];
}

// Appends one ICE candidate to the room file while holding an exclusive lock.
function append_ice_candidate(string $dataDir, string $room, string $side, string $target, string $sessionId, array $candidate): void
{
    $path = ice_path($dataDir, $room, $side, $target);
    $handle = fopen($path, 'c+');
    if (!$handle) {
        throw new RuntimeException('Could not open ICE file.');
    }

    try {
        flock($handle, LOCK_EX);
        rewind($handle);
        $raw = stream_get_contents($handle);
        $data = json_decode((string)$raw, true);
        if (!is_array($data) || ($data['sessionId'] ?? '') !== $sessionId) {
            $data = [
                'room' => $room,
                'side' => $side,
                'target' => $target,
                'sessionId' => $sessionId,
                'nextId' => 1,
                'candidates' => [],
            ];
        }

        $id = (int)($data['nextId'] ?? 1);
        $data['candidates'][] = [
            'id' => $id,
            'candidate' => $candidate,
            'serverTs' => time_ms(),
        ];
        $data['nextId'] = $id + 1;
        $data['candidates'] = array_slice($data['candidates'], -200);

        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        fflush($handle);
        flock($handle, LOCK_UN);
    } finally {
        fclose($handle);
    }
}

// Returns ICE candidates newer than the last ID already seen by the client.
function read_ice_candidates(string $dataDir, string $room, string $side, string $target, string $sessionId, int $after): array
{
    $data = read_json_file(ice_path($dataDir, $room, $side, $target), []);
    if (!is_array($data) || $sessionId === '' || ($data['sessionId'] ?? '') !== $sessionId) {
        return [];
    }

    $items = [];
    foreach (($data['candidates'] ?? []) as $item) {
        if ((int)($item['id'] ?? 0) > $after) {
            $items[] = $item;
        }
    }

    return $items;
}

// Builds the JSON filename used for ICE candidates in one room and direction.
function ice_path(string $dataDir, string $room, string $side, string $target): string
{
    return $dataDir . '/webrtc-ice-' . $room . '-' . $side . '-' . $target . '.json';
}

// Clears stale offer, answer, and ICE files before a new WebRTC attempt starts.
function reset_signaling(string $dataDir, string $room, ?string $side): void
{
    $sides = $side ? [$side] : SIDES;
    foreach ($sides as $item) {
        clear_file($dataDir . '/webrtc-offer-' . $room . '-' . $item . '.json');
        clear_file($dataDir . '/webrtc-answer-' . $room . '-' . $item . '.json');
        clear_file($dataDir . '/webrtc-ice-' . $room . '-' . $item . '-admin.json');
        clear_file($dataDir . '/webrtc-ice-' . $room . '-' . $item . '-camera.json');
    }
}

// Deletes a signaling file when it exists.
function clear_file(string $path): void
{
    if (is_file($path)) {
        unlink($path);
    }
}

// Reads a JSON file and returns a fallback if it is missing or invalid.
function read_json_file(string $path, mixed $fallback): mixed
{
    if (!is_file($path)) {
        return $fallback;
    }

    $raw = file_get_contents($path);
    $data = json_decode((string)$raw, true);
    return is_array($data) ? $data : $fallback;
}

// Writes JSON atomically enough for this small file-based signaling store.
function write_json_locked(string $path, array $data): void
{
    $handle = fopen($path, 'c+');
    if (!$handle) {
        throw new RuntimeException('Could not open JSON file.');
    }

    try {
        flock($handle, LOCK_EX);
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        fflush($handle);
        flock($handle, LOCK_UN);
    } finally {
        fclose($handle);
    }
}

// Sends a no-cache JSON response and stops script execution.
function json_response(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

// Returns the current Unix time in milliseconds for heartbeat and signaling timestamps.
function time_ms(): int
{
    return (int)floor(microtime(true) * 1000);
}
