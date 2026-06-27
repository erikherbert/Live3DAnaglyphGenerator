(() => {
  'use strict';

  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
  const PREVIEW_MAX_WIDTH = 1280;
  const FULLSCREEN_MAX_WIDTH = 1920;
  const SIDES = ['a', 'b'];

  const els = {
    serverStatus: document.getElementById('serverStatus'),
    cameraALink: document.getElementById('cameraALink'),
    cameraBLink: document.getElementById('cameraBLink'),
    shareCameraA: document.getElementById('shareCameraA'),
    shareCameraB: document.getElementById('shareCameraB'),
    reconnectButton: document.getElementById('reconnectButton'),
    captureButton: document.getElementById('captureButton'),
    captureFormat: document.getElementById('captureFormat'),
    captureMessage: document.getElementById('captureMessage'),
    lastCaptureMeta: document.getElementById('lastCaptureMeta'),
    resultGrid: document.getElementById('resultGrid'),
    statusA: document.getElementById('statusA'),
    statusB: document.getElementById('statusB'),
    mediaA: document.getElementById('mediaA'),
    mediaB: document.getElementById('mediaB'),
    videoA: document.getElementById('videoA'),
    videoB: document.getElementById('videoB'),
    stageA: document.getElementById('stageA'),
    stageB: document.getElementById('stageB'),
    metaA: document.getElementById('metaA'),
    metaB: document.getElementById('metaB'),
    anaglyphMeta: document.getElementById('anaglyphMeta'),
    anaglyphMode: document.getElementById('anaglyphMode'),
    shiftX: document.getElementById('shiftX'),
    shiftY: document.getElementById('shiftY'),
    intensity: document.getElementById('intensity'),
    brightness: document.getElementById('brightness'),
    contrast: document.getElementById('contrast'),
    saturation: document.getElementById('saturation'),
    previewFps: document.getElementById('previewFps'),
    swapImages: document.getElementById('swapImages'),
    cropEdges: document.getElementById('cropEdges'),
    shiftXValue: document.getElementById('shiftXValue'),
    shiftYValue: document.getElementById('shiftYValue'),
    intensityValue: document.getElementById('intensityValue'),
    brightnessValue: document.getElementById('brightnessValue'),
    contrastValue: document.getElementById('contrastValue'),
    saturationValue: document.getElementById('saturationValue'),
    previewFpsValue: document.getElementById('previewFpsValue'),
    autoAlign: document.getElementById('autoAlign'),
    resetAnaglyph: document.getElementById('resetAnaglyph'),
    downloadAnaglyph: document.getElementById('downloadAnaglyph'),
    fullscreenAnaglyph: document.getElementById('fullscreenAnaglyph'),
    anaglyphCanvas: document.getElementById('anaglyphCanvas'),
    anaglyphStage: document.getElementById('anaglyphStage'),
    anaglyphPlaceholder: document.getElementById('anaglyphPlaceholder'),
    fullscreenPreview: document.getElementById('fullscreenPreview'),
    fullscreenMeta: document.getElementById('fullscreenMeta'),
    fullscreenPlaceholder: document.getElementById('fullscreenPlaceholder'),
    fullscreenAnaglyphCanvas: document.getElementById('fullscreenAnaglyphCanvas'),
    closeFullscreenPreview: document.getElementById('closeFullscreenPreview'),
    saveFullscreenAnaglyph: document.getElementById('saveFullscreenAnaglyph')
  };

  const anaglyphDefaults = {
    anaglyphMode: 'dubois',
    shiftX: 0,
    shiftY: 0,
    intensity: 100,
    brightness: 100,
    contrast: 100,
    saturation: 100,
    previewFps: 2,
    swapImages: false,
    cropEdges: true
  };

  const anaglyphControls = [
    els.anaglyphMode,
    els.shiftX,
    els.shiftY,
    els.intensity,
    els.brightness,
    els.contrast,
    els.saturation,
    els.previewFps,
    els.swapImages,
    els.cropEdges
  ];

  const state = {
    roomId: getOrCreateRoomId(),
    sessionId: '',
    polling: false,
    anaglyphTimer: 0,
    previewLoopTimer: 0,
    renderBusy: false,
    fullscreenOpen: false,
    captureNoticeUntil: 0,
    resultUrls: [],
    peers: {
      a: makePeerState(),
      b: makePeerState()
    }
  };

  setCameraLinks();
  bindEvents();
  updateAnaglyphReadouts();
  clearAnaglyphCanvas('Waiting for both camera streams.');

  if (!window.RTCPeerConnection) {
    setBadge(els.serverStatus, 'WebRTC unavailable', 'error');
    els.captureMessage.textContent = 'This browser does not support WebRTC.';
  } else {
    rebuildConnections();
    window.setInterval(pollState, 1000);
    startPreviewRenderLoop();
  }

  window.addEventListener('beforeunload', () => {
    clearResultUrls();
    SIDES.forEach((side) => closePeer(side));
  });

  // Creates the per-camera WebRTC state used by the admin page.
  function makePeerState() {
    return {
      pc: null,
      answerSet: false,
      remoteIceAfter: 0,
      pendingIce: [],
      answerTimer: 0,
      iceTimer: 0,
      connectionState: 'new'
    };
  }

  // Connects UI controls, keyboard shortcuts, and video events to their handlers.
  function bindEvents() {
    els.reconnectButton.addEventListener('click', rebuildConnections);
    els.shareCameraA.addEventListener('click', () => shareCameraLink('a'));
    els.shareCameraB.addEventListener('click', () => shareCameraLink('b'));
    els.captureButton.addEventListener('click', captureCurrentFrames);
    els.autoAlign.addEventListener('click', runAutoAlign);
    els.resetAnaglyph.addEventListener('click', resetAnaglyphSettings);
    els.downloadAnaglyph.addEventListener('click', downloadAnaglyphPng);
    els.fullscreenAnaglyph.addEventListener('click', openFullscreenPreview);
    els.closeFullscreenPreview.addEventListener('click', closeFullscreenPreview);
    els.saveFullscreenAnaglyph.addEventListener('click', downloadAnaglyphPng);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.fullscreenOpen) {
        closeFullscreenPreview();
      }
    });

    [els.videoA, els.videoB].forEach((video) => {
      video.addEventListener('loadedmetadata', () => {
        updateCaptureAvailability();
        scheduleAnaglyphRender();
      });
      video.addEventListener('resize', () => {
        updateCaptureAvailability();
        scheduleAnaglyphRender();
      });
    });

    anaglyphControls.forEach((control) => {
      control.addEventListener('input', scheduleAnaglyphRender);
      control.addEventListener('change', scheduleAnaglyphRender);
    });

    els.previewFps.addEventListener('input', startPreviewRenderLoop);
    els.previewFps.addEventListener('change', startPreviewRenderLoop);
  }

  // Writes room-specific camera URLs into the admin link section.
  function setCameraLinks() {
    const base = getAppBaseUrl();
    const room = encodeURIComponent(state.roomId);
    els.cameraALink.href = `${base}camera.php?side=a&room=${room}`;
    els.cameraALink.textContent = `${base}camera.php?side=a&room=${room}`;
    els.cameraBLink.href = `${base}camera.php?side=b&room=${room}`;
    els.cameraBLink.textContent = `${base}camera.php?side=b&room=${room}`;
  }

  // Shares a camera URL with the Web Share API, falling back to copy-to-clipboard.
  async function shareCameraLink(side) {
    const link = side === 'a' ? els.cameraALink : els.cameraBLink;
    const button = side === 'a' ? els.shareCameraA : els.shareCameraB;
    const label = side === 'a' ? 'Camera A link' : 'Camera B link';
    const url = link.href;

    try {
      if (navigator.share) {
        await navigator.share({
          title: label,
          text: `Open this ${label} for Live 3D Anaglyph Generator.`,
          url
        });
        showShareFeedback(button, 'Shared');
        return;
      }

      await copyText(url);
      showShareFeedback(button, 'Copied');
    } catch (error) {
      if (error && error.name === 'AbortError') return;

      try {
        await copyText(url);
        showShareFeedback(button, 'Copied');
      } catch (copyError) {
        setBadge(els.serverStatus, 'Sharing failed', 'error');
        els.captureMessage.textContent = copyError.message || 'Camera link could not be shared.';
      }
    }
  }

  // Copies text through the Clipboard API, with a textarea fallback for older browsers.
  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '-1000px';
    field.style.left = '-1000px';
    document.body.appendChild(field);
    field.focus();
    field.select();

    try {
      if (!document.execCommand('copy')) {
        throw new Error('Camera link could not be copied.');
      }
    } finally {
      field.remove();
    }
  }

  // Shows short visual feedback after a link was shared or copied.
  function showShareFeedback(button, text) {
    const originalLabel = button.dataset.originalLabel || button.getAttribute('aria-label') || 'Share camera link';
    button.dataset.originalLabel = originalLabel;
    button.classList.add('is-copied');
    button.setAttribute('aria-label', text);
    button.title = text;

    window.setTimeout(() => {
      button.classList.remove('is-copied');
      button.setAttribute('aria-label', originalLabel);
      button.title = originalLabel;
    }, 1400);
  }

  // Returns the absolute base URL of the current PHP app directory.
  function getAppBaseUrl() {
    const path = window.location.pathname || '/';
    if (path.endsWith('/')) {
      return `${window.location.origin}${path}`;
    }

    return `${window.location.origin}${path.slice(0, path.lastIndexOf('/') + 1)}`;
  }

  // Reuses a strong room ID from the URL or creates a new private room.
  function getOrCreateRoomId() {
    const params = new URLSearchParams(window.location.search);
    const current = params.get('room');
    if (current && isStrongGeneratedId(current)) {
      return current;
    }

    const room = makeSessionId();
    params.set('room', room);
    const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(null, '', nextUrl);
    return room;
  }

  // Resets signaling for this room and creates fresh WebRTC offers for both cameras.
  async function rebuildConnections() {
    state.sessionId = makeSessionId();
    setBadge(els.serverStatus, 'Rebuilding signaling', 'warn');
    els.captureMessage.textContent = 'Preparing WebRTC connections ...';

    SIDES.forEach((side) => closePeer(side));

    try {
      await postJson('api.php?action=signal-reset', {
        room: state.roomId
      });
    } catch (error) {
      setBadge(els.serverStatus, 'PHP API unreachable', 'error');
      els.captureMessage.textContent = error.message;
      return;
    }

    await Promise.all(SIDES.map((side) => createOfferForSide(side)));
    await pollState();
  }

  // Creates a timestamped ID with 32 random hex characters when crypto is available.
  function makeSessionId() {
    if (window.crypto && window.crypto.getRandomValues) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return `${Date.now().toString(36)}-${random}`;
    }

    const random = Array.from({ length: 4 }, () => Math.random().toString(16).slice(2).padEnd(8, '0').slice(0, 8)).join('');
    return `${Date.now().toString(36)}-${random}`;
  }

  // Verifies that a room/session ID uses the expected strong generated format.
  function isStrongGeneratedId(value) {
    return /^[a-z0-9]+-[a-f0-9]{32}$/.test(value);
  }

  // Creates a receive-only WebRTC offer for one camera side.
  async function createOfferForSide(side) {
    const peer = state.peers[side];
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peer.pc = pc;
    peer.answerSet = false;
    peer.remoteIceAfter = 0;
    peer.pendingIce = [];
    peer.connectionState = 'new';

    pc.addTransceiver('video', { direction: 'recvonly' });

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;

      const video = videoForSide(side);
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      video.play().catch(() => {});
      stageForSide(side).classList.add('has-image');
      updateCaptureAvailability();
      scheduleAnaglyphRender();
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      postJson('api.php?action=signal-ice', {
        side,
        room: state.roomId,
        target: 'camera',
        sessionId: state.sessionId,
        candidate: event.candidate.toJSON()
      }).catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      peer.connectionState = pc.connectionState;
      updateCaptureAvailability();
    };

    pc.oniceconnectionstatechange = () => {
      peer.connectionState = pc.connectionState || pc.iceConnectionState;
      updateCaptureAvailability();
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await postJson('api.php?action=signal-offer', {
        side,
        room: state.roomId,
        sessionId: state.sessionId,
        description: {
          type: pc.localDescription.type,
          sdp: pc.localDescription.sdp
        }
      });

      peer.answerTimer = window.setInterval(() => pollAnswer(side), 750);
      peer.iceTimer = window.setInterval(() => pollRemoteIce(side), 750);
      await pollAnswer(side);
      await pollRemoteIce(side);
    } catch (error) {
      setBadge(els.serverStatus, `WebRTC ${sideLabel(side)} error`, 'error');
      metaForSide(side).textContent = error.message;
    }
  }

  // Closes one camera peer connection and clears its live preview.
  function closePeer(side) {
    const peer = state.peers[side];
    window.clearInterval(peer.answerTimer);
    window.clearInterval(peer.iceTimer);
    peer.answerTimer = 0;
    peer.iceTimer = 0;
    peer.answerSet = false;
    peer.remoteIceAfter = 0;
    peer.pendingIce = [];
    peer.connectionState = 'closed';

    if (peer.pc) {
      peer.pc.ontrack = null;
      peer.pc.onicecandidate = null;
      peer.pc.onconnectionstatechange = null;
      peer.pc.oniceconnectionstatechange = null;
      peer.pc.close();
      peer.pc = null;
    }

    const video = videoForSide(side);
    video.srcObject = null;
    stageForSide(side).classList.remove('has-image');
  }

  // Waits for the camera page to answer the admin WebRTC offer.
  async function pollAnswer(side) {
    const peer = state.peers[side];
    if (!peer.pc || peer.answerSet) return;

    try {
      const data = await fetchJson(`api.php?action=signal-answer&side=${encodeURIComponent(side)}&room=${encodeURIComponent(state.roomId)}&sessionId=${encodeURIComponent(state.sessionId)}&ts=${Date.now()}`);
      if (!data.answer || !data.answer.description) return;

      await peer.pc.setRemoteDescription(data.answer.description);
      peer.answerSet = true;
      window.clearInterval(peer.answerTimer);
      peer.answerTimer = 0;
      await flushPendingIce(side);
      updateCaptureAvailability();
    } catch (error) {
      metaForSide(side).textContent = error.message;
    }
  }

  // Pulls ICE candidates from the PHP signaling endpoint for the admin peer.
  async function pollRemoteIce(side) {
    const peer = state.peers[side];
    if (!peer.pc) return;

    try {
      const url = `api.php?action=signal-ice&side=${encodeURIComponent(side)}&room=${encodeURIComponent(state.roomId)}&target=admin&sessionId=${encodeURIComponent(state.sessionId)}&after=${peer.remoteIceAfter}&ts=${Date.now()}`;
      const data = await fetchJson(url);
      for (const item of data.candidates || []) {
        peer.remoteIceAfter = Math.max(peer.remoteIceAfter, Number(item.id) || 0);
        await addRemoteCandidate(side, item.candidate);
      }
    } catch (error) {
      metaForSide(side).textContent = error.message;
    }
  }

  // Adds a remote ICE candidate, or queues it until the remote description exists.
  async function addRemoteCandidate(side, candidate) {
    const peer = state.peers[side];
    if (!peer.pc || !candidate) return;

    if (!peer.pc.remoteDescription) {
      peer.pendingIce.push(candidate);
      return;
    }

    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      if (!/closed/i.test(error.message || '')) {
        metaForSide(side).textContent = error.message;
      }
    }
  }

  // Applies queued ICE candidates after the answer has been accepted.
  async function flushPendingIce(side) {
    const peer = state.peers[side];
    const items = peer.pendingIce.splice(0);
    for (const candidate of items) {
      await addRemoteCandidate(side, candidate);
    }
  }

  // Reads camera heartbeats and signaling status from the PHP API.
  async function pollState() {
    if (state.polling) return;
    state.polling = true;

    try {
      const data = await fetchJson(`api.php?action=state&room=${encodeURIComponent(state.roomId)}&ts=${Date.now()}`);
      setBadge(els.serverStatus, 'PHP signaling connected', 'ok');
      renderCameraState('a', data.cameras.a);
      renderCameraState('b', data.cameras.b);
      updateCaptureAvailability();
    } catch (error) {
      setBadge(els.serverStatus, 'PHP API unreachable', 'error');
      els.captureButton.disabled = true;
      els.captureMessage.textContent = error.message;
    } finally {
      state.polling = false;
    }
  }

  // Updates one camera card based on heartbeat data and WebRTC video readiness.
  function renderCameraState(side, camera) {
    const video = videoForSide(side);
    const statusEl = statusForSide(side);
    const mediaEl = mediaForSide(side);
    const metaEl = metaForSide(side);
    const peer = state.peers[side];
    const heartbeat = camera?.heartbeat || {};
    const videoReady = isVideoReady(video);

    if (videoReady) {
      statusEl.textContent = 'Live connected';
      setBadge(mediaEl, `${video.videoWidth} x ${video.videoHeight}`, 'ok');
      metaEl.textContent = `WebRTC: ${readablePeerState(peer.connectionState)}.`;
      stageForSide(side).classList.add('has-image');
      return;
    }

    if (camera?.connected && heartbeat.running) {
      statusEl.textContent = 'Camera active';
      setBadge(mediaEl, 'Waiting for WebRTC', 'warn');
      metaEl.textContent = `Camera reports ${heartbeat.width || '-'} x ${heartbeat.height || '-'} px, ${timeAgo(heartbeat.serverTs)}.`;
      return;
    }

    statusEl.textContent = 'Not connected';
    setBadge(mediaEl, '-', 'error');
    metaEl.textContent = 'Stream: -';
    stageForSide(side).classList.remove('has-image');
  }

  // Enables capture only when both live video streams are ready.
  function updateCaptureAvailability() {
    const ready = bothVideosReady();
    els.captureButton.disabled = !ready;
    if (Date.now() < state.captureNoticeUntil) return;

    if (ready) {
      els.captureMessage.textContent = 'Ready. `Take Photo` downloads the frames locally.';
    } else {
      els.captureMessage.textContent = 'Waiting for both WebRTC streams.';
    }
  }

  // Checks whether both left and right video elements contain usable frames.
  function bothVideosReady() {
    return isVideoReady(els.videoA) && isVideoReady(els.videoB);
  }

  // Checks whether a video element has decoded frame dimensions.
  function isVideoReady(video) {
    return Boolean(video && video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2);
  }

  // Captures both current camera frames locally and starts browser downloads.
  async function captureCurrentFrames() {
    if (!bothVideosReady()) {
      els.captureMessage.textContent = 'Both streams must be live.';
      return;
    }

    els.captureButton.disabled = true;
    els.captureMessage.textContent = 'Creating frames locally ...';

    try {
      const stamp = makeTimestamp(new Date());
      const format = els.captureFormat.value === 'png' ? 'png' : 'jpg';
      const [left, right] = await Promise.all([
        captureStill('a', stamp, format),
        captureStill('b', stamp, format)
      ]);

      downloadBlob(left.blob, left.fileName);
      downloadBlob(right.blob, right.fileName);

      const anaglyph = buildAnaglyphCanvas(getAnaglyphSettings(), Number.POSITIVE_INFINITY);
      if (anaglyph) {
        const blob = await canvasToBlob(anaglyph.canvas, 'image/png', 1);
        downloadBlob(blob, `anaglyph-3d-${stamp}.png`);
      }

      renderResults([left, right]);
      els.lastCaptureMeta.textContent = `Capture ${stamp}: Downloads were started in the browser.`;
      els.captureMessage.textContent = 'Done. No image file was stored on the server.';
      state.captureNoticeUntil = Date.now() + 5000;
    } catch (error) {
      els.captureMessage.textContent = error.message;
    } finally {
      els.captureButton.disabled = !bothVideosReady();
    }
  }

  // Draws one live video frame to a canvas and converts it into a downloadable file.
  async function captureStill(side, stamp, format) {
    const video = videoForSide(side);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const quality = format === 'png' ? 1 : 0.96;
    const blob = await canvasToBlob(canvas, mime, quality);
    const extension = format === 'png' ? 'png' : 'jpg';
    const label = side === 'a' ? 'left' : 'right';
    const url = URL.createObjectURL(blob);
    state.resultUrls.push(url);

    return {
      side,
      blob,
      url,
      width: canvas.width,
      height: canvas.height,
      fileName: `capture-${label}-${stamp}.${extension}`
    };
  }

  // Renders the latest captured left/right stills in the admin page.
  function renderResults(files) {
    clearResultUrls(files.map((file) => file.url));
    const bySide = {
      a: files.find((file) => file.side === 'a'),
      b: files.find((file) => file.side === 'b')
    };

    els.resultGrid.replaceChildren(
      bySide.a ? makeResultCard(bySide.a) : makeEmptyResult('Left missing'),
      bySide.b ? makeResultCard(bySide.b) : makeEmptyResult('Right missing')
    );
  }

  // Builds one result card with preview, size, and download link.
  function makeResultCard(file) {
    const card = document.createElement('article');
    card.className = 'result-card';

    const imageWrap = document.createElement('div');
    imageWrap.className = 'result-image';

    const image = document.createElement('img');
    image.src = file.url;
    image.alt = `${sideLabel(file.side)} capture`;
    imageWrap.append(image);

    const links = document.createElement('div');
    links.className = 'result-links';

    const label = document.createElement('span');
    label.textContent = `${sideLabel(file.side)} ${file.width} x ${file.height}`;

    const download = document.createElement('a');
    download.href = file.url;
    download.download = file.fileName;
    download.textContent = 'Download';

    links.append(label, download);
    card.append(imageWrap, links);
    return card;
  }

  // Builds an empty result card for a missing capture side.
  function makeEmptyResult(text) {
    const card = document.createElement('article');
    card.className = 'result-card';

    const imageWrap = document.createElement('div');
    imageWrap.className = 'result-image empty';
    imageWrap.textContent = text;

    card.append(imageWrap);
    return card;
  }

  // Releases object URLs that are no longer displayed to avoid memory leaks.
  function clearResultUrls(keep = []) {
    const keepSet = new Set(keep);
    state.resultUrls = state.resultUrls.filter((url) => {
      if (keepSet.has(url)) return true;
      URL.revokeObjectURL(url);
      return false;
    });
  }

  // Debounces anaglyph rendering so sliders stay responsive while moving.
  function scheduleAnaglyphRender() {
    updateAnaglyphReadouts();
    window.clearTimeout(state.anaglyphTimer);
    state.anaglyphTimer = window.setTimeout(renderAnaglyphPreview, 60);
  }

  // Runs the live anaglyph refresh loop at the selected preview frame rate.
  function startPreviewRenderLoop() {
    updateAnaglyphReadouts();
    window.clearTimeout(state.previewLoopTimer);

    const fps = getPreviewFps();
    state.previewLoopTimer = window.setTimeout(() => {
      scheduleAnaglyphRender();
      startPreviewRenderLoop();
    }, Math.round(1000 / fps));
  }

  // Mirrors the current slider values into the visible numeric readouts.
  function updateAnaglyphReadouts() {
    els.shiftXValue.textContent = `${els.shiftX.value} px`;
    els.shiftYValue.textContent = `${els.shiftY.value} px`;
    els.intensityValue.textContent = `${els.intensity.value} %`;
    els.brightnessValue.textContent = `${els.brightness.value} %`;
    els.contrastValue.textContent = `${els.contrast.value} %`;
    els.saturationValue.textContent = `${els.saturation.value} %`;
    els.previewFpsValue.textContent = `${getPreviewFps()} fps`;
  }

  // Normalizes the preview frame-rate slider to the supported 1-10 fps range.
  function getPreviewFps() {
    const value = Number(els.previewFps.value);
    if (value < 1) return 1;
    if (value > 10) return 10;
    return Math.round(value);
  }

  // Reads all anaglyph controls and converts percentage values into multipliers.
  function getAnaglyphSettings() {
    return {
      mode: els.anaglyphMode.value,
      shiftX: Number(els.shiftX.value),
      shiftY: Number(els.shiftY.value),
      intensity: Number(els.intensity.value) / 100,
      brightness: Number(els.brightness.value) / 100,
      contrast: Number(els.contrast.value) / 100,
      saturation: Number(els.saturation.value) / 100,
      swapImages: els.swapImages.checked,
      cropEdges: els.cropEdges.checked
    };
  }

  // Builds the current live anaglyph frame and paints it into the preview canvases.
  function renderAnaglyphPreview() {
    if (state.renderBusy) return;
    state.renderBusy = true;

    try {
      const settings = getAnaglyphSettings();
      const previewWidth = state.fullscreenOpen ? FULLSCREEN_MAX_WIDTH : PREVIEW_MAX_WIDTH;
      const result = buildAnaglyphCanvas(settings, previewWidth);

      if (!result) {
        clearAnaglyphCanvas('Waiting for both WebRTC streams.');
        return;
      }

      copyCanvas(result.canvas, els.anaglyphCanvas);
      if (state.fullscreenOpen) {
        copyCanvas(result.canvas, els.fullscreenAnaglyphCanvas);
      }
      els.anaglyphStage.classList.add('has-image');
      els.downloadAnaglyph.disabled = false;
      els.fullscreenAnaglyph.disabled = false;
      els.saveFullscreenAnaglyph.disabled = false;
      els.autoAlign.disabled = false;

      const cropInfo = result.cropped ? ', edges cropped' : '';
      els.anaglyphMeta.textContent = `Live from WebRTC, ${result.width} x ${result.height} px${cropInfo}.`;
      els.fullscreenMeta.textContent = `Live from WebRTC, ${result.width} x ${result.height} px${cropInfo}.`;
      els.fullscreenPlaceholder.hidden = true;
    } catch (error) {
      clearAnaglyphCanvas(error.message || 'Anaglyph preview could not be rendered.');
    } finally {
      state.renderBusy = false;
    }
  }

  // Clears the preview canvases and shows a user-facing placeholder message.
  function clearAnaglyphCanvas(message) {
    const ctx = els.anaglyphCanvas.getContext('2d');
    els.anaglyphCanvas.width = 1;
    els.anaglyphCanvas.height = 1;
    ctx.clearRect(0, 0, 1, 1);
    els.anaglyphStage.classList.remove('has-image');
    els.anaglyphPlaceholder.textContent = message;
    els.anaglyphMeta.textContent = message;
    els.fullscreenPlaceholder.textContent = message;
    els.fullscreenPlaceholder.hidden = false;
    els.fullscreenMeta.textContent = message;
    els.downloadAnaglyph.disabled = true;
    els.fullscreenAnaglyph.disabled = true;
    els.saveFullscreenAnaglyph.disabled = true;
    els.autoAlign.disabled = true;
  }

  // Opens the fullscreen anaglyph preview and renders a high-resolution frame.
  function openFullscreenPreview() {
    if (!bothVideosReady()) return;

    state.fullscreenOpen = true;
    els.fullscreenPreview.hidden = false;
    document.body.classList.add('preview-open');
    els.closeFullscreenPreview.focus();

    if (els.anaglyphCanvas.width > 1 && els.anaglyphCanvas.height > 1) {
      copyCanvas(els.anaglyphCanvas, els.fullscreenAnaglyphCanvas);
      els.fullscreenPlaceholder.hidden = true;
    }

    scheduleAnaglyphRender();
  }

  // Closes fullscreen preview mode and returns rendering to the inline canvas.
  function closeFullscreenPreview() {
    state.fullscreenOpen = false;
    els.fullscreenPreview.hidden = true;
    document.body.classList.remove('preview-open');
    scheduleAnaglyphRender();
  }

  // Creates a standalone anaglyph canvas from the current left and right video frames.
  function buildAnaglyphCanvas(settings, maxWidth) {
    const sources = getVideoSources();
    if (!sources) return null;

    const active = settings.swapImages
      ? { left: sources.right, right: sources.left }
      : sources;
    const sourceWidth = Math.max(1, Math.min(active.left.width, active.right.width));
    const sourceHeight = Math.max(1, Math.min(active.left.height, active.right.height));
    const scale = Number.isFinite(maxWidth) ? Math.min(1, maxWidth / sourceWidth) : 1;
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const base = {
      leftData: renderImageData(active.left.image, width, height),
      rightData: renderImageData(active.right.image, width, height),
      width,
      height
    };
    const canvas = document.createElement('canvas');
    const meta = drawAnaglyphToCanvas(canvas, base, settings);
    return {
      canvas,
      width: meta.width,
      height: meta.height,
      cropped: meta.cropped
    };
  }

  // Returns normalized source metadata for the two live video elements.
  function getVideoSources() {
    if (!bothVideosReady()) return null;

    return {
      left: {
        image: els.videoA,
        width: els.videoA.videoWidth,
        height: els.videoA.videoHeight
      },
      right: {
        image: els.videoB,
        width: els.videoB.videoWidth,
        height: els.videoB.videoHeight
      }
    };
  }

  // Draws an image/video source to an offscreen canvas and returns its pixel data.
  function renderImageData(image, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);

    return ctx.getImageData(0, 0, width, height).data;
  }

  // Mixes left/right pixel channels into a red/cyan anaglyph according to the settings.
  function drawAnaglyphToCanvas(canvas, base, settings) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = base.width;
    const height = base.height;
    const lastX = width - 1;
    const lastY = height - 1;
    const shiftX = Math.round(settings.shiftX);
    const shiftY = Math.round(settings.shiftY);
    const cropX = settings.cropEdges ? Math.min(Math.abs(shiftX), lastX) : 0;
    const cropY = settings.cropEdges ? Math.min(Math.abs(shiftY), lastY) : 0;
    const outputWidth = Math.max(1, width - cropX);
    const outputHeight = Math.max(1, height - cropY);
    const leftOffsetX = settings.cropEdges ? Math.min(Math.max(0, shiftX), lastX) : 0;
    const leftOffsetY = settings.cropEdges ? Math.min(Math.max(0, shiftY), lastY) : 0;

    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const output = ctx.createImageData(outputWidth, outputHeight);
    const out = output.data;

    for (let y = 0; y < outputHeight; y += 1) {
      const leftY = settings.cropEdges ? limitIndex(y + leftOffsetY, lastY) : y;
      const rightY = settings.cropEdges
        ? limitIndex(leftY - shiftY, lastY)
        : limitIndex(y - shiftY, lastY);

      for (let x = 0; x < outputWidth; x += 1) {
        const leftX = settings.cropEdges ? limitIndex(x + leftOffsetX, lastX) : x;
        const i = (leftY * width + leftX) * 4;
        const oi = (y * outputWidth + x) * 4;
        const rightX = settings.cropEdges
          ? limitIndex(leftX - shiftX, lastX)
          : limitIndex(x - shiftX, lastX);
        const ri = (rightY * width + rightX) * 4;

        let lr = base.leftData[i] * settings.brightness;
        let lg = base.leftData[i + 1] * settings.brightness;
        let lb = base.leftData[i + 2] * settings.brightness;
        let rr = base.rightData[ri] * settings.brightness;
        let rg = base.rightData[ri + 1] * settings.brightness;
        let rb = base.rightData[ri + 2] * settings.brightness;

        lr = (lr - 128) * settings.contrast + 128;
        lg = (lg - 128) * settings.contrast + 128;
        lb = (lb - 128) * settings.contrast + 128;
        rr = (rr - 128) * settings.contrast + 128;
        rg = (rg - 128) * settings.contrast + 128;
        rb = (rb - 128) * settings.contrast + 128;

        const leftLum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
        const rightLum = 0.2126 * rr + 0.7152 * rg + 0.0722 * rb;

        lr = leftLum + (lr - leftLum) * settings.saturation;
        lg = leftLum + (lg - leftLum) * settings.saturation;
        lb = leftLum + (lb - leftLum) * settings.saturation;
        rr = rightLum + (rr - rightLum) * settings.saturation;
        rg = rightLum + (rg - rightLum) * settings.saturation;
        rb = rightLum + (rb - rightLum) * settings.saturation;

        let targetR = lr;
        let targetG = rg;
        let targetB = rb;

        if (settings.mode === 'gray') {
          targetR = leftLum;
          targetG = rightLum;
          targetB = rightLum;
        } else if (settings.mode === 'half') {
          targetR = leftLum;
          targetG = rg;
          targetB = rb;
        } else if (settings.mode === 'dubois') {
          targetR = 0.437 * lr + 0.449 * lg + 0.164 * lb - 0.062 * rr - 0.062 * rg - 0.024 * rb;
          targetG = -0.011 * lr - 0.032 * lg - 0.007 * lb + 0.377 * rr + 0.761 * rg - 0.009 * rb;
          targetB = -0.018 * lr - 0.034 * lg - 0.006 * lb - 0.026 * rr - 0.093 * rg + 1.234 * rb;
        }

        const baseR = (lr + rr) * 0.5;
        const baseG = (lg + rg) * 0.5;
        const baseB = (lb + rb) * 0.5;

        out[oi] = limitByte(baseR + (targetR - baseR) * settings.intensity);
        out[oi + 1] = limitByte(baseG + (targetG - baseG) * settings.intensity);
        out[oi + 2] = limitByte(baseB + (targetB - baseB) * settings.intensity);
        out[oi + 3] = 255;
      }
    }

    ctx.putImageData(output, 0, 0);
    return {
      width: outputWidth,
      height: outputHeight,
      cropped: outputWidth !== width || outputHeight !== height
    };
  }

  // Copies one canvas into another without changing the rendered image content.
  function copyCanvas(source, target) {
    target.width = source.width;
    target.height = source.height;
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(source, 0, 0);
  }

  // Clamps a color channel value to the valid 0-255 byte range.
  function limitByte(value) {
    if (value < 0) return 0;
    if (value > 255) return 255;
    return value;
  }

  // Clamps a pixel coordinate so shifted sampling never reads outside the image.
  function limitIndex(value, max) {
    if (value < 0) return 0;
    if (value > max) return max;
    return value;
  }

  // Restores all anaglyph controls to the default preview settings.
  function resetAnaglyphSettings() {
    Object.entries(anaglyphDefaults).forEach(([key, value]) => {
      const element = els[key];
      if (!element) return;

      if (element.type === 'checkbox') {
        element.checked = value;
      } else {
        element.value = value;
      }
    });
    startPreviewRenderLoop();
    scheduleAnaglyphRender();
  }

  // Estimates a useful horizontal shift by comparing edge detail in both frames.
  function runAutoAlign() {
    const settings = getAnaglyphSettings();
    const sources = getVideoSources();
    if (!sources) {
      clearAnaglyphCanvas('Auto-align needs both live streams.');
      return;
    }

    const active = settings.swapImages
      ? { left: sources.right, right: sources.left }
      : sources;
    const width = Math.max(1, Math.min(active.left.width, active.right.width));
    const height = Math.max(1, Math.min(active.left.height, active.right.height));
    const sampleWidth = 360;
    const sampleHeight = Math.max(80, Math.round(sampleWidth * height / width));
    const scaleX = sampleWidth / width;
    const scaleY = sampleHeight / height;
    const minShift = Number(els.shiftX.min);
    const maxShift = Number(els.shiftX.max);
    const minDx = Math.round(minShift * scaleX);
    const maxDx = Math.round(maxShift * scaleX);
    const dy = Math.round(settings.shiftY * scaleY);
    const leftGray = makeEdgeSample(makeGraySample(active.left.image, sampleWidth, sampleHeight), sampleWidth, sampleHeight);
    const rightGray = makeEdgeSample(makeGraySample(active.right.image, sampleWidth, sampleHeight), sampleWidth, sampleHeight);

    let bestDx = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let dx = minDx; dx <= maxDx; dx += 2) {
      const score = scoreShift(leftGray, rightGray, sampleWidth, sampleHeight, dx, dy);
      if (score < bestScore) {
        bestScore = score;
        bestDx = dx;
      }
    }

    for (let dx = bestDx - 2; dx <= bestDx + 2; dx += 1) {
      const score = scoreShift(leftGray, rightGray, sampleWidth, sampleHeight, dx, dy);
      if (score < bestScore) {
        bestScore = score;
        bestDx = dx;
      }
    }

    els.shiftX.value = String(Math.max(minShift, Math.min(maxShift, Math.round(bestDx / scaleX))));
    scheduleAnaglyphRender();
  }

  // Converts a downscaled frame into grayscale data for fast alignment scoring.
  function makeGraySample(image, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);

    const data = ctx.getImageData(0, 0, width, height).data;
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      gray[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    return gray;
  }

  // Extracts simple edge strength from grayscale data to make alignment more robust.
  function makeEdgeSample(gray, width, height) {
    const edge = new Uint8ClampedArray(width * height);
    for (let y = 1; y < height - 1; y += 1) {
      const row = y * width;
      const topRow = (y - 1) * width;
      const bottomRow = (y + 1) * width;
      for (let x = 1; x < width - 1; x += 1) {
        const dx = Math.abs(gray[row + x + 1] - gray[row + x - 1]);
        const dy = Math.abs(gray[bottomRow + x] - gray[topRow + x]);
        edge[row + x] = Math.min(255, dx + dy);
      }
    }
    return edge;
  }

  // Scores how well two edge samples match for a given horizontal/vertical shift.
  function scoreShift(leftGray, rightGray, width, height, dx, dy) {
    const margin = 8;
    const xStart = Math.max(margin, dx + margin);
    const xEnd = Math.min(width - margin, width + dx - margin);
    const yStart = Math.max(margin, dy + margin);
    const yEnd = Math.min(height - margin, height + dy - margin);

    if (xEnd <= xStart || yEnd <= yStart) {
      return Number.POSITIVE_INFINITY;
    }

    let score = 0;
    let count = 0;
    for (let y = yStart; y < yEnd; y += 2) {
      const rightY = y - dy;
      const leftRow = y * width;
      const rightRow = rightY * width;
      for (let x = xStart; x < xEnd; x += 2) {
        score += Math.abs(leftGray[leftRow + x] - rightGray[rightRow + x - dx]);
        count += 1;
      }
    }

    return score / count;
  }

  // Renders the full-size anaglyph and downloads it as a PNG file.
  async function downloadAnaglyphPng() {
    if (!bothVideosReady()) return;

    const result = buildAnaglyphCanvas(getAnaglyphSettings(), Number.POSITIVE_INFINITY);
    if (!result) return;

    const blob = await canvasToBlob(result.canvas, 'image/png', 1);
    downloadBlob(blob, `anaglyph-3d-${makeTimestamp(new Date())}.png`);
  }

  // Converts a canvas into a Blob, including a data-URL fallback for older browsers.
  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      if (canvas.toBlob) {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Canvas could not create an image blob.'));
          }
        }, mime, quality);
        return;
      }

      const dataUrl = canvas.toDataURL(mime, quality);
      const parts = dataUrl.split(',');
      const binary = atob(parts[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      resolve(new Blob([bytes], { type: mime }));
    });
  }

  // Starts a browser download for a Blob without sending image data to the server.
  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // Fetches JSON from the API and throws readable errors for failed responses.
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

  // Sends JSON to the API and throws readable errors for failed responses.
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

  // Updates a status badge and applies its visual state class.
  function setBadge(element, text, mode) {
    element.textContent = text;
    element.classList.remove('is-ok', 'is-warn', 'is-error');
    element.classList.add(`is-${mode}`);
  }

  // Returns the video element for the requested camera side.
  function videoForSide(side) {
    return side === 'a' ? els.videoA : els.videoB;
  }

  // Returns the preview stage element for the requested camera side.
  function stageForSide(side) {
    return side === 'a' ? els.stageA : els.stageB;
  }

  // Returns the status text element for the requested camera side.
  function statusForSide(side) {
    return side === 'a' ? els.statusA : els.statusB;
  }

  // Returns the resolution/status badge for the requested camera side.
  function mediaForSide(side) {
    return side === 'a' ? els.mediaA : els.mediaB;
  }

  // Returns the metadata text element for the requested camera side.
  function metaForSide(side) {
    return side === 'a' ? els.metaA : els.metaB;
  }

  // Converts the internal side key into a readable left/right label.
  function sideLabel(side) {
    return side === 'a' ? 'Left' : 'Right';
  }

  // Converts browser WebRTC connection states into stable display text.
  function readablePeerState(value) {
    if (value === 'connected') return 'connected';
    if (value === 'connecting') return 'connecting';
    if (value === 'disconnected') return 'disconnected';
    if (value === 'failed') return 'failed';
    if (value === 'closed') return 'closed';
    return value || 'waiting';
  }

  // Formats capture timestamps for deterministic download filenames.
  function makeTimestamp(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join('') + '-' + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds())
    ].join('');
  }

  // Formats a millisecond timestamp as a short relative age.
  function timeAgo(timestamp) {
    if (!timestamp) return '-';
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 2) return 'just now';
    return `${seconds} s ago`;
  }
})();
