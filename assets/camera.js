(() => {
  'use strict';

  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
  const side = window.CAMERA_SIDE === 'b' ? 'b' : 'a';
  const roomId = new URLSearchParams(window.location.search).get('room') || '';
  const roomIsValid = /^[a-zA-Z0-9._-]{1,80}$/.test(roomId);

  const els = {
    status: document.getElementById('cameraStatus'),
    note: document.getElementById('cameraNote'),
    video: document.getElementById('cameraVideo'),
    start: document.getElementById('startCamera'),
    restart: document.getElementById('restartCamera'),
    facingMode: document.getElementById('facingMode'),
    resolution: document.getElementById('resolution')
  };

  const state = {
    stream: null,
    cameraRunning: false,
    pc: null,
    sessionId: '',
    offerKey: '',
    pendingOffer: null,
    remoteIceAfter: 0,
    pendingIce: [],
    offerTimer: 0,
    iceTimer: 0,
    heartbeatTimer: 0,
    webrtcState: 'new'
  };

  els.start.addEventListener('click', startCamera);
  els.restart.addEventListener('click', restartCamera);
  els.facingMode.addEventListener('change', restartCamera);
  els.resolution.addEventListener('change', restartCamera);

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Camera unsupported', 'error');
    setNote('This browser does not support getUserMedia().');
  } else if (!window.isSecureContext) {
    setStatus('HTTPS required', 'error');
    setNote('Mobile Safari allows camera access only over HTTPS or localhost.');
  } else if (!window.RTCPeerConnection) {
    setStatus('WebRTC unavailable', 'error');
    setNote('This browser does not support WebRTC.');
  } else if (!roomIsValid) {
    setStatus('Room missing', 'error');
    setNote('Open this page through the camera link from the admin view.');
    els.start.disabled = true;
    els.restart.disabled = true;
  } else {
    setStatus('Ready', 'warn');
    setNote('Tap `Start Camera`. The live image will then stream directly to the admin browser via WebRTC.');
  }

  if (
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia &&
    window.isSecureContext &&
    window.RTCPeerConnection &&
    roomIsValid
  ) {
    startLoops();
  }

  window.addEventListener('beforeunload', () => {
    stopPeer();
    stopCamera();
  });

  // Starts the camera page background loops for signaling and presence updates.
  function startLoops() {
    pollOffer();
    state.offerTimer = window.setInterval(pollOffer, 1000);
    sendHeartbeat();
    state.heartbeatTimer = window.setInterval(sendHeartbeat, 2000);
  }

  // Requests the selected browser camera and prepares it for a WebRTC connection.
  async function startCamera() {
    if (!roomIsValid) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

    stopCamera();
    setStatus('Starting camera ...', 'warn');

    try {
      const constraints = buildConstraints();
      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
      els.video.srcObject = state.stream;
      await els.video.play();

      state.cameraRunning = true;
      setStatus('Camera active', 'ok');
      setNote('Camera is running. Once the admin view is open, WebRTC connects directly to the preview.');
      await sendHeartbeat();

      if (state.pendingOffer) {
        await connectToOffer(state.pendingOffer);
      } else {
        await pollOffer();
      }
    } catch (error) {
      state.cameraRunning = false;
      setStatus('Camera error', 'error');
      setNote(readableCameraError(error));
      await sendHeartbeat();
    }
  }

  // Rebuilds the local camera stream after a camera or resolution change.
  async function restartCamera() {
    stopPeer();
    await startCamera();
  }

  // Stops all active media tracks so the browser releases the camera hardware.
  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
    }

    state.stream = null;
    state.cameraRunning = false;
    els.video.srcObject = null;
  }

  // Converts the UI camera settings into getUserMedia constraints.
  function buildConstraints() {
    const [width, height] = els.resolution.value.split('x').map(Number);
    return {
      audio: false,
      video: {
        facingMode: { ideal: els.facingMode.value },
        width: { ideal: width },
        height: { ideal: height }
      }
    };
  }

  // Checks whether the admin page has published a WebRTC offer for this camera.
  async function pollOffer() {
    if (!window.RTCPeerConnection || !roomId) return;

    try {
      const data = await fetchJson(`api.php?action=signal-offer&side=${encodeURIComponent(side)}&room=${encodeURIComponent(roomId)}&ts=${Date.now()}`);
      if (!data.offer || !data.offer.description || !data.offer.sessionId) {
        if (state.cameraRunning && !state.pc) {
          setStatus('Waiting for admin', 'warn');
          setNote('Camera is running. Open the admin page or reconnect there.');
        }
        return;
      }

      const offerKey = `${data.offer.sessionId}:${data.offer.serverTs || ''}`;
      if (offerKey === state.offerKey && state.pc) return;

      state.pendingOffer = data.offer;
      if (!state.cameraRunning) {
        setStatus('Admin ready', 'warn');
        setNote('The admin view is waiting for this stream. Tap `Start Camera`.');
        return;
      }

      await connectToOffer(data.offer);
    } catch (error) {
      setStatus('API unreachable', 'error');
      setNote(error.message);
    }
  }

  // Accepts the admin WebRTC offer and sends this camera stream back as an answer.
  async function connectToOffer(offer) {
    stopPeer();

    state.sessionId = offer.sessionId;
    state.offerKey = `${offer.sessionId}:${offer.serverTs || ''}`;
    state.pendingOffer = offer;
    state.remoteIceAfter = 0;
    state.pendingIce = [];
    state.webrtcState = 'connecting';

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    state.pc = pc;

    state.stream.getTracks().forEach((track) => {
      pc.addTrack(track, state.stream);
    });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      postJson('api.php?action=signal-ice', {
        side,
        room: roomId,
        target: 'admin',
        sessionId: state.sessionId,
        candidate: event.candidate.toJSON()
      }).catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      state.webrtcState = pc.connectionState;
      renderConnectionState();
      sendHeartbeat();
    };

    pc.oniceconnectionstatechange = () => {
      state.webrtcState = pc.connectionState || pc.iceConnectionState;
      renderConnectionState();
      sendHeartbeat();
    };

    try {
      await pc.setRemoteDescription(offer.description);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await postJson('api.php?action=signal-answer', {
        side,
        room: roomId,
        sessionId: state.sessionId,
        description: {
          type: pc.localDescription.type,
          sdp: pc.localDescription.sdp
        }
      });

      window.clearInterval(state.iceTimer);
      state.iceTimer = window.setInterval(pollRemoteIce, 750);
      await pollRemoteIce();
      await flushPendingIce();
      setStatus('WebRTC connecting', 'warn');
      setNote('Stream is released. The admin browser is establishing the direct connection.');
    } catch (error) {
      setStatus('WebRTC error', 'error');
      setNote(error.message);
      stopPeer();
    }
  }

  // Closes the current peer connection while keeping the local camera selection intact.
  function stopPeer() {
    window.clearInterval(state.iceTimer);
    state.iceTimer = 0;
    state.remoteIceAfter = 0;
    state.pendingIce = [];
    state.webrtcState = 'closed';

    if (state.pc) {
      state.pc.onicecandidate = null;
      state.pc.onconnectionstatechange = null;
      state.pc.oniceconnectionstatechange = null;
      state.pc.close();
      state.pc = null;
    }
  }

  // Pulls new ICE candidates from the PHP signaling endpoint for this peer connection.
  async function pollRemoteIce() {
    if (!state.pc || !state.sessionId) return;

    try {
      const url = `api.php?action=signal-ice&side=${encodeURIComponent(side)}&room=${encodeURIComponent(roomId)}&target=camera&sessionId=${encodeURIComponent(state.sessionId)}&after=${state.remoteIceAfter}&ts=${Date.now()}`;
      const data = await fetchJson(url);
      for (const item of data.candidates || []) {
        state.remoteIceAfter = Math.max(state.remoteIceAfter, Number(item.id) || 0);
        await addRemoteCandidate(item.candidate);
      }
    } catch (error) {
      setNote(error.message);
    }
  }

  // Adds a remote ICE candidate, or queues it until the remote description is ready.
  async function addRemoteCandidate(candidate) {
    if (!state.pc || !candidate) return;

    if (!state.pc.remoteDescription) {
      state.pendingIce.push(candidate);
      return;
    }

    try {
      await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      if (!/closed/i.test(error.message || '')) {
        setNote(error.message);
      }
    }
  }

  // Applies ICE candidates that arrived before the remote description was available.
  async function flushPendingIce() {
    const items = state.pendingIce.splice(0);
    for (const candidate of items) {
      await addRemoteCandidate(candidate);
    }
  }

  // Sends lightweight status data so the admin page can show camera availability.
  async function sendHeartbeat() {
    try {
      await postJson('api.php?action=heartbeat', {
        side,
        room: roomId,
        running: state.cameraRunning,
        width: els.video.videoWidth || 0,
        height: els.video.videoHeight || 0,
        facingMode: els.facingMode.value,
        resolution: els.resolution.value,
        webrtcState: state.webrtcState,
        sessionId: state.sessionId,
        clientTs: Date.now()
      });

      if (state.cameraRunning && !state.pc) {
        setStatus('Camera active', 'ok');
      }
    } catch (error) {
      setStatus('API unreachable', 'error');
      setNote(error.message);
    }
  }

  // Turns the current WebRTC state into clear camera-page status text.
  function renderConnectionState() {
    if (!state.cameraRunning) return;

    if (state.webrtcState === 'connected') {
      setStatus('Live connected', 'ok');
      setNote('The admin view sees this camera stream live. Image data runs via WebRTC, not as a server upload.');
      return;
    }

    if (state.webrtcState === 'failed') {
      setStatus('WebRTC failed', 'error');
      setNote('Direct connection failed. Try `Reconnect` in the admin view or use the same Wi-Fi network.');
      return;
    }

    if (state.webrtcState === 'disconnected') {
      setStatus('Connection interrupted', 'warn');
      setNote('The stream is briefly interrupted. WebRTC keeps trying automatically.');
      return;
    }

    setStatus('WebRTC connecting', 'warn');
  }

  // Fetches JSON from the API and turns non-OK API responses into JavaScript errors.
  async function fetchJson(url) {
    const response = await fetch(url, {
      cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || 'API error.');
    }
    return data;
  }

  // Sends JSON to the API and returns the decoded response when it succeeds.
  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || 'API error.');
    }
    return data;
  }

  // Updates the main status badge and applies the visual state class.
  function setStatus(text, mode) {
    els.status.textContent = text;
    els.status.classList.remove('is-ok', 'is-warn', 'is-error');
    els.status.classList.add(`is-${mode}`);
  }

  // Updates the explanatory note below the camera controls.
  function setNote(text) {
    els.note.textContent = text;
  }

  // Converts common browser camera errors into messages a user can act on.
  function readableCameraError(error) {
    if (!window.isSecureContext) {
      return 'HTTPS is missing. On iOS Safari, camera access works only over HTTPS or localhost.';
    }

    if (error.name === 'NotAllowedError') {
      return 'Camera access was denied. Allow camera access in Safari and reload the page.';
    }

    if (error.name === 'NotFoundError') {
      return 'No matching camera found.';
    }

    if (error.name === 'NotReadableError') {
      return 'The camera is already in use or could not be started.';
    }

    return error.message || 'Unknown camera error.';
  }
})();
