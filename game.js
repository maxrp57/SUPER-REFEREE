(() => {
  "use strict";

  const canvas = document.querySelector("#rink");
  const gl = canvas.getContext("webgl", { alpha: false, antialias: true, powerPreference: "high-performance" });
  const frame = document.querySelector("#rink-frame");
  const ui = {
    homeScore: document.querySelector("#home-score"),
    awayScore: document.querySelector("#away-score"),
    clock: document.querySelector("#game-clock"),
    period: document.querySelector("#period-label"),
    clockState: document.querySelector("#clock-state"),
    liveLabel: document.querySelector("#live-label"),
    incidentCard: document.querySelector("#incident-card"),
    incidentTitle: document.querySelector("#incident-title"),
    incidentCopy: document.querySelector("#incident-copy"),
    incidentCount: document.querySelector("#incident-count"),
    incidentIcon: document.querySelector("#incident-icon"),
    toast: document.querySelector("#toast"),
    callout: document.querySelector("#callout"),
    accuracy: document.querySelector("#accuracy-value"),
    accuracyBar: document.querySelector("#accuracy-bar"),
    refPosition: document.querySelector("#ref-position"),
    level: document.querySelector("#career-level"),
    xp: document.querySelector("#career-xp"),
    progress: document.querySelector("#xp-progress"),
    nextLevel: document.querySelector("#next-level"),
    cameraMode: document.querySelector("#camera-mode"),
    uniform: document.querySelector("#uniform-color"),
    settings: document.querySelector("#settings-dialog"),
    periodDialog: document.querySelector("#period-dialog"),
    whistleDialog: document.querySelector("#whistle-dialog"),
    whistleContext: document.querySelector("#whistle-context"),
    resultTitle: document.querySelector("#result-title"),
    resultEyebrow: document.querySelector("#result-eyebrow"),
    resultCopy: document.querySelector("#result-copy"),
    resultStats: document.querySelector("#result-stats"),
  };
  const WORLD = { width: 1400, height: 720, left: 80, right: 1320, top: 55, bottom: 665, centerX: 700, centerY: 360 };
  const RINK = { left: 102, right: 1298, top: 78, bottom: 642, blueLeft: 450, blueRight: 950, goalLeft: 145, goalRight: 1255 };
  const defaults = { up: "w", down: "s", left: "a", right: "d", whistle: " " };
  const stored = readStore();
  const state = {
    players: [],
    puck: { x: 700, y: 360, vx: 0, vy: 0, carrier: null, lastTouch: null, fromX: 700, fromY: 360, shot: false },
    refs: [],
    userRef: null,
    camera: { x: 700, y: 360, yaw: Math.PI / 2 },
    cameraView: "chase",
    score: [0, 0],
    period: 1,
    attackToRight: true,
    remaining: 1200,
    gameSecondsPerRealSecond: 30,
    running: true,
    pending: null,
    penalty: null,
    decisions: 0,
    correct: 0,
    points: 0,
    incidents: 0,
    career: stored.career,
    uniform: stored.uniform,
    bindings: stored.bindings,
    pressed: new Set(),
    touch: { x: 0, y: 0, active: false, pointer: null },
    facingX: 1,
    facingZ: 0,
    lastFrame: 0,
    lastIncidentAt: -100,
    toastTimer: 0,
    gameOver: false,
  };
  const renderer = gl ? createRenderer(gl) : null;

  function readStore() {
    try {
      const saved = JSON.parse(localStorage.getItem("super-referee-save") || "{}");
      return {
        career: { xp: Math.max(0, Number(saved.career?.xp) || 0), matches: Math.max(0, Number(saved.career?.matches) || 0), correct: Math.max(0, Number(saved.career?.correct) || 0) },
        uniform: typeof saved.uniform === "string" ? saved.uniform : "#f4f4f0",
        bindings: { ...defaults, ...(saved.bindings && typeof saved.bindings === "object" ? saved.bindings : {}) },
      };
    } catch (error) {
      console.warn("La sauvegarde locale n'a pas pu être lue.", error);
      return { career: { xp: 0, matches: 0, correct: 0 }, uniform: "#f4f4f0", bindings: { ...defaults } };
    }

  }

  function formatClock(seconds) {
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  }

  function save() {
    try {
      localStorage.setItem("super-referee-save", JSON.stringify({
        career: state.career,
        uniform: state.uniform,
        bindings: state.bindings,
      }));
    } catch (error) {
      console.warn("La progression ne peut pas être enregistrée sur cet appareil.", error);
      toast("Sauvegarde indisponible sur cet appareil");
    }
  }

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const approachAngle = (current, target, maxStep) => {
    const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    return current + clamp(difference, -maxStep, maxStep);
  };
  const random = (min, max) => min + Math.random() * (max - min);
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const attackDir = team => (team === 0) === state.attackToRight ? 1 : -1;
  const opponentGoalX = team => attackDir(team) > 0 ? RINK.goalRight : RINK.goalLeft;

  function createPlayer(team, role, x, y, number) {
    return { team, role, x, y, vx: 0, vy: 0, yaw: Math.PI / 2, homeX: x, homeY: y, number, speed: role === "goalie" ? 65 : 104 + Math.random() * 18, radius: role === "goalie" ? 16 : 12, nextMove: 0, target: null, checkCooldown: 0 };
  }

  function resetPlayers() {
    state.players = [];
    for (let team = 0; team < 2; team++) {
      const direction = attackDir(team);
      const lineX = team === 0 ? 560 : 840;
      const coords = [
        [WORLD.centerX - 40 * direction, WORLD.centerY],
        [lineX, WORLD.centerY - 72],
        [lineX, WORLD.centerY + 72],
        [team === 0 ? 340 : 1060, WORLD.centerY - 120],
        [team === 0 ? 340 : 1060, WORLD.centerY + 120],
        [team === 0 ? 175 : 1225, WORLD.centerY],
      ];
      coords.forEach(([x, y], i) => {
        const player = createPlayer(team, i === 5 ? "goalie" : "skater", x, y, i + 1);
        player.yaw = Math.atan2(direction, 0);
        state.players.push(player);
      });
    }
    state.refs = [
      { x: 700, y: 295, vx: 0, vy: 0, role: "user", radius: 13, speed: 142, yaw: Math.PI / 2 },
      { x: 700, y: 425, vx: 0, vy: 0, role: "assistant", radius: 12, speed: 115, target: null, think: 0, yaw: -Math.PI / 2 },
    ];
    state.userRef = state.refs[0];
    state.facingX = attackDir(0);
    state.facingZ = 0;
    state.userRef.yaw = Math.atan2(state.facingX, state.facingZ);
    state.camera.yaw = state.userRef.yaw;
    state.camera.x = state.userRef.x;
    state.camera.y = state.userRef.y;
    state.puck = { x: 700, y: 360, vx: 0, vy: 0, carrier: null, lastTouch: null, fromX: 700, fromY: 360, shot: false };
    giveFaceoff(700, 360);
  }

  function giveFaceoff(x, y) {
    state.puck.x = x; state.puck.y = y; state.puck.vx = 0; state.puck.vy = 0;
    state.puck.carrier = null; state.puck.shot = false; state.puck.fromX = x; state.puck.fromY = y;
    const nearest = state.players.filter(p => p.role === "skater").sort((a, b) => Math.abs(a.x - x) + Math.abs(a.y - y) - (Math.abs(b.x - x) + Math.abs(b.y - y)));
    if (nearest.length >= 2) {
      nearest[0].x = x - 24; nearest[0].y = y;
      nearest[1].x = x + 24; nearest[1].y = y;
    }
  }

  function updateScoreboard() {
    ui.homeScore.textContent = state.score[0];
    ui.awayScore.textContent = state.score[1];
    ui.clock.textContent = `${String(Math.floor(state.remaining / 60)).padStart(2, "0")}:${String(Math.floor(state.remaining % 60)).padStart(2, "0")}`;
    ui.period.textContent = `${state.period}${state.period === 1 ? "re" : "e"} PÉRIODE`;
    ui.clockState.textContent = state.pending ? "DÉCISION REQUISE" : state.penalty ? `PÉNALITÉ · ${state.penalty.team === 0 ? "DOM." : "VIS."} ${formatClock(state.penalty.remaining)}` : state.running ? "MATCH EN DIRECT" : state.gameOver ? "MATCH TERMINÉ" : "MATCH EN PAUSE";
    ui.liveLabel.textContent = state.pending ? "DÉCISION À PRENDRE" : state.running ? "MATCH EN DIRECT" : state.gameOver ? "MATCH TERMINÉ" : "MATCH EN PAUSE";
    ui.accuracy.textContent = state.decisions ? `${Math.round(state.correct / state.decisions * 100)}%` : "—";
    ui.accuracyBar.style.width = `${state.decisions ? state.correct / state.decisions * 100 : 0}%`;
    const level = Math.floor(state.career.xp / 100) + 1;
    const inLevel = state.career.xp % 100;
    ui.level.textContent = `Niveau ${level}`;
    ui.xp.textContent = `${state.career.xp} XP`;
    ui.progress.style.width = `${inLevel}%`;
    ui.nextLevel.textContent = `Encore ${100 - inLevel} XP pour le niveau suivant`;
    const side = state.userRef.x < 450 ? "Zone défensive" : state.userRef.x > 950 ? "Zone offensive" : "Zone neutre";
    ui.refPosition.textContent = side;
  }

  function resize() {
    const rect = frame.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    if (gl) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (renderer) renderer.resize(canvas.width, canvas.height);
    }
  }

  function movePlayerToward(player, x, y, dt, speed = player.speed) {
    const dx = x - player.x, dy = y - player.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) { player.vx *= .8; player.vy *= .8; return; }
    const velocity = Math.min(speed, len * 2.2);
    player.vx += (dx / len * velocity - player.vx) * Math.min(1, dt * 5);
    player.vy += (dy / len * velocity - player.vy) * Math.min(1, dt * 5);
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    if (Math.hypot(player.vx, player.vy) > 3) player.yaw = Math.atan2(player.vx, player.vy);
    player.x = clamp(player.x, RINK.left + 18, RINK.right - 18);
    player.y = clamp(player.y, RINK.top + 18, RINK.bottom - 18);
  }

  function playerAI(dt, now) {
    const puck = state.puck;
    const carrier = puck.carrier;
    state.players.forEach(p => {
      p.previousX = p.x;
      p.checkCooldown = Math.max(0, p.checkCooldown - dt);
      const dir = attackDir(p.team);
      if (state.penalty && p.team === state.penalty.team && p.role === "skater" && p.number === 5) {
        p.vx = 0; p.vy = 0;
        return;
      }
      if (p.role === "goalie") {
        const x = dir > 0 ? 175 : 1225;
        movePlayerToward(p, x, clamp(puck.y, 290, 430), dt, p.speed);
        return;
      }
      let tx, ty;
      if (!carrier) {
        if (p === state.players.filter(s => s.role === "skater").sort((a, b) => distance(a, puck) - distance(b, puck))[0]) {
          tx = puck.x; ty = puck.y;
        } else {
          const slot = p.number % 4;
          tx = clamp(puck.x - dir * (55 + slot * 26), RINK.left + 45, RINK.right - 45);
          ty = clamp(puck.y + (slot % 2 ? 1 : -1) * (48 + slot * 15), RINK.top + 50, RINK.bottom - 50);
        }
      } else if (carrier === p) {
        const goalX = opponentGoalX(p.team);
        const distToGoal = Math.abs(goalX - p.x);
        const pressured = state.players.some(opponent => opponent.team !== p.team && opponent.role === "skater" && distance(opponent, p) < 75);
        const inOwnHalf = (p.x - WORLD.centerX) * dir < 0;
        if (inOwnHalf && pressured && now > p.nextMove && Math.random() < .08) {
          clearPuck(p);
          p.nextMove = now + random(3, 5);
        }
        if (distToGoal < 340 && now > p.nextMove) {
          p.nextMove = now + random(2.2, 4.1);
          if (Math.random() < .72) shoot(p, false);
          else pass(p);
        }
        tx = clamp(p.x + dir * 155, RINK.left + 35, RINK.right - 35);
        ty = clamp(p.y + (WORLD.centerY - p.y) * .35, RINK.top + 48, RINK.bottom - 48);
      } else if (p.team === carrier.team) {
        const slot = p.number % 4;
        tx = clamp(carrier.x - dir * (45 + slot * 28), RINK.left + 40, RINK.right - 40);
        ty = clamp(carrier.y + (slot % 2 ? 1 : -1) * (56 + slot * 13), RINK.top + 42, RINK.bottom - 42);
      } else {
        const goalX = opponentGoalX(p.team);
        if (distance(p, carrier) < 190 && p.number % 3 === 1) {
          tx = carrier.x; ty = carrier.y;
          if (distance(p, carrier) < 24 && p.checkCooldown === 0 && Math.random() < .005) {
            p.checkCooldown = 4;
                    raiseIncident("penalty", "Charge par derrière", "Contact irrégulier détecté dans le jeu.", p.team);
          }
        } else {
          tx = clamp((carrier.x + goalX) * .5, RINK.left + 50, RINK.right - 50);
          ty = clamp(carrier.y + (p.number % 2 ? 75 : -75), RINK.top + 35, RINK.bottom - 35);
        }
      }
      movePlayerToward(p, tx, ty, dt);
    });

    if (!carrier && Math.hypot(puck.vx, puck.vy) < 90) {
      const nearest = state.players.filter(p => p.role === "skater" && !(state.penalty && p.team === state.penalty.team && p.number === 5)).sort((a, b) => distance(a, puck) - distance(b, puck))[0];
      if (nearest && distance(nearest, puck) < 19) {
        puck.carrier = nearest;
        puck.lastTouch = nearest.team;
        puck.vx = 0; puck.vy = 0;
        puck.shot = false;
      }
    }

    if (carrier && carrier.role === "skater") {
      puck.x = carrier.x + attackDir(carrier.team) * 13;
      puck.y = carrier.y + 5;
      if (Math.random() < dt * .34 && carrier.nextMove < now) {
        const defenders = state.players.filter(p => p.team !== carrier.team && p.role === "skater");
        const closeDefender = defenders.some(p => distance(p, carrier) < 46);
        if (closeDefender) {
          const teammates = state.players.filter(p => p.team === carrier.team && p.role === "skater" && p !== carrier);
          const mate = teammates.sort((a, b) => distance(a, carrier) - distance(b, carrier))[0];
          if (mate && Math.random() < .68) pass(carrier);
        }
      }
      checkRinkEvents();
    }

    if (puck.vx || puck.vy) {
      puck.x += puck.vx * dt;
      puck.y += puck.vy * dt;
      const drag = Math.pow(.987, dt * 60);
      puck.vx *= drag; puck.vy *= drag;
      if (puck.y < RINK.top + 8 || puck.y > RINK.bottom - 8) { puck.vy *= -.8; puck.y = clamp(puck.y, RINK.top + 8, RINK.bottom - 8); }
      checkRinkEvents();
    }

    const assist = state.refs[1];
    assist.think -= dt;
    if (assist.think <= 0) {
      assist.think = .6;
      assist.target = { x: clamp(puck.x - 25, RINK.left + 45, RINK.right - 45), y: clamp(puck.y + (puck.y < WORLD.centerY ? 75 : -75), RINK.top + 35, RINK.bottom - 35) };
    }
    movePlayerToward(assist, assist.target.x, assist.target.y, dt, assist.speed);
  }

  function pass(player) {
    const mates = state.players.filter(p => p.team === player.team && p.role === "skater" && p !== player);
    if (!mates.length) return;
    const target = mates.sort((a, b) => distance(a, player) - distance(b, player))[0];
    const dx = target.x - player.x, dy = target.y - player.y, len = Math.hypot(dx, dy) || 1;
    state.puck.carrier = null;
    state.puck.lastTouch = player.team;
    state.puck.vx = dx / len * 325;
    state.puck.vy = dy / len * 325;
    state.puck.fromX = player.x; state.puck.fromY = player.y;
    state.puck.shot = false;
    player.nextMove = performance.now() / 1000 + 1;
  }

  function shoot(player, userShot) {
    const targetX = opponentGoalX(player.team);
    const goalie = state.players.find(p => p.team !== player.team && p.role === "goalie");
    const targetY = goalie ? goalie.y + random(-39, 39) : WORLD.centerY;
    const dx = targetX - player.x, dy = targetY - player.y, len = Math.hypot(dx, dy) || 1;
    state.puck.carrier = null;
    state.puck.lastTouch = player.team;
    state.puck.vx = dx / len * (userShot ? 530 : 425);
    state.puck.vy = dy / len * (userShot ? 530 : 425);
    state.puck.fromX = player.x; state.puck.fromY = player.y;
    state.puck.shot = true;
    player.nextMove = performance.now() / 1000 + random(1.6, 3.2);
  }

  function clearPuck(player) {
    const dir = attackDir(player.team);
    state.puck.carrier = null;
    state.puck.lastTouch = player.team;
    state.puck.vx = dir * 475;
    state.puck.vy = clamp((WORLD.centerY - player.y) * 1.1, -115, 115);
    state.puck.fromX = player.x;
    state.puck.fromY = player.y;
    state.puck.shot = true;
  }

  function checkRinkEvents() {
    const puck = state.puck;
    if (state.pending) return;
    const carrier = puck.carrier;
    if (puck.shot && puck.carrier === null) {
      const goalie = state.players.find(p => p.team !== puck.lastTouch && p.role === "goalie");
      if (goalie && distance(goalie, puck) < goalie.radius + 6) {
        raiseIncident("save", "Arrêt du gardien", "Le gardien semble avoir bloqué le tir. Décide si le but est refusé.");
        return;
      }
    }
    if (puck.x > RINK.goalRight + 5 || puck.x < RINK.goalLeft - 5) {
      if (Math.abs(puck.y - WORLD.centerY) < 49 && puck.shot) {
        raiseIncident("goal", "But à confirmer", "Le palet vient de franchir la ligne de but. Valide ou refuse le but.");
      } else if (puck.shot && puck.lastTouch !== null) {
        const direction = attackDir(puck.lastTouch);
        const startOnOwnHalf = direction > 0 ? puck.fromX < WORLD.centerX : puck.fromX > WORLD.centerX;
        const beyondOpponentGoal = direction > 0 ? puck.x > RINK.goalRight : puck.x < RINK.goalLeft;
        if (startOnOwnHalf && beyondOpponentGoal) raiseIncident("icing", "Dégagement interdit ?", "Le palet a traversé la patinoire sans être touché.");
        else restartAtEnd();
      } else restartAtEnd();
      return;
    }
    for (const player of state.players) {
      if (player.role !== "skater" || player === carrier || player.team !== puck.lastTouch) continue;
      const crossedBeforePuck = attackDir(player.team) > 0
        ? player.previousX <= RINK.blueRight && player.x > RINK.blueRight && puck.x < RINK.blueRight
        : player.previousX >= RINK.blueLeft && player.x < RINK.blueLeft && puck.x > RINK.blueLeft;
      if (crossedBeforePuck) {
        raiseIncident("offside", "Hors-jeu ?", "Un attaquant a franchi la ligne bleue avant le palet.");
        break;
      }
    }
  }

  function restartAtEnd() {
    const zoneX = state.puck.x < WORLD.centerX ? 320 : 1080;
    giveFaceoff(zoneX, WORLD.centerY + random(-70, 70));
  }

  function raiseIncident(type, title, copy, team = null) {
    const now = performance.now() / 1000;
    if (state.pending || now - state.lastIncidentAt < 7) return;
    state.lastIncidentAt = now;
    state.incidents++;
    state.pending = { type, title, copy, team, started: now, duration: 6 };
    ui.incidentCard.hidden = false;
    ui.incidentTitle.textContent = title;
    ui.incidentCopy.textContent = copy;
    ui.incidentIcon.textContent = type === "offside" ? "⇥" : type === "icing" ? "➤" : type === "penalty" ? "✦" : "✓";
    ui.callout.innerHTML = `<span class="callout-icon">!</span><p><strong>${escapeHTML(title)}</strong><br>${escapeHTML(copy)}</p>`;
    updateScoreboard();
    toast(type === "goal" ? "Palet dans le filet — décision !" : "Situation à arbitrer !");
  }

  function escapeHTML(text) { return text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }

  const actions = {
    offside: { label: "Hors-jeu", matches: ["offside"] },
    icing: { label: "Dégagement interdit", matches: ["icing"] },
    penalty: { label: "Faute / pénalité", matches: ["penalty"] },
    goal: { label: "But validé", matches: ["goal"] },
    "no-goal": { label: "But refusé", matches: ["save"] },
    "play-on": { label: "Laisser jouer", matches: [] },
  };

  function makeCall(action) {
    const pending = state.pending;
    const decision = actions[action];
    if (!decision) return;
    if (ui.whistleDialog?.open) ui.whistleDialog.close();
    if (!pending && action === "play-on") {
      toast("Pas d'infraction, le jeu continue.");
      return;
    }
    state.decisions++;
    const correct = pending ? decision.matches.includes(pending.type) : decision.matches.length === 0;
    if (correct) {
      state.correct++;
      state.points += pending ? 15 : 2;
      state.career.xp += pending ? 15 : 2;
      if (pending?.type === "goal") {
        const team = state.puck.lastTouch === 0 ? 0 : 1;
        state.score[team]++;
        toast(`BUT ${team === 0 ? "DOMICILE" : "VISITEURS"} ! +15 XP`);
        giveFaceoff(WORLD.centerX, WORLD.centerY);
      } else if (pending) {
        if (pending.type === "penalty" && pending.team !== null) {
          state.penalty = { team: pending.team, remaining: 120 };
        }
        toast(`Bonne décision : ${decision.label} · +15 XP`);
        restartForIncident(pending.type);
      } else {
        toast("Bonne lecture du jeu · +2 XP");
      }
      ui.callout.innerHTML = `<span class="callout-icon">✓</span><p><strong>${pending ? "Bonne décision !" : "Jeu laissé en cours."}</strong><br>${pending ? `${escapeHTML(decision.label)} — les joueurs reprennent le jeu.` : "Pas d'infraction, le jeu continue."}</p>`;
    } else {
      state.points = Math.max(0, state.points - 5);
      toast(pending ? `Erreur de jugement : ${pending.type === "goal" ? "but à confirmer" : pending.type}` : "Mauvais coup de sifflet · −5 points");
      const correctDecision = pending ? ({ goal: "valider le but", save: "refuser le but", offside: "hors-jeu", icing: "dégagement interdit", penalty: "pénalité" }[pending.type] || "laisser jouer") : "";
      ui.callout.innerHTML = `<span class="callout-icon">!</span><p><strong>Décision incorrecte.</strong><br>${pending ? `La bonne décision était : ${correctDecision}.` : "Aucune infraction à signaler."}</p>`;
      if (pending) restartForIncident(pending.type);
    }
    state.pending = null;
    ui.incidentCard.hidden = true;
    save();
    updateScoreboard();
  }

  function expireIncident() {
    if (!state.pending) return;
    const pending = state.pending;
    state.decisions++;
    const missed = ({ offside: "hors-jeu", icing: "dégagement interdit", penalty: "pénalité", goal: "but à confirmer", save: "arrêt du gardien" })[pending.type];
    ui.callout.innerHTML = `<span class="callout-icon">⌛</span><p><strong>Temps écoulé.</strong><br>Situation manquée : ${escapeHTML(missed)}.</p>`;
    state.pending = null;
    ui.incidentCard.hidden = true;
    restartForIncident(pending.type);
    updateScoreboard();
  }

  function restartForIncident(type) {
    if (type === "icing" && state.puck.lastTouch !== null) {
      giveFaceoff(attackDir(state.puck.lastTouch) > 0 ? 320 : 1080, WORLD.centerY);
    } else if (type === "offside") {
      const offenseDirection = state.puck.lastTouch === null ? 1 : attackDir(state.puck.lastTouch);
      giveFaceoff(offenseDirection > 0 ? RINK.blueRight - 35 : RINK.blueLeft + 35, WORLD.centerY);
    } else {
      restartAtEnd();
    }
  }

  function tick(dt, now) {
    if (!state.running || state.gameOver) return;
    if (state.pending) {
      const left = Math.max(0, state.pending.duration - (now - state.pending.started));
      ui.incidentCount.textContent = left.toFixed(1);
      if (left <= 0) expireIncident();
      return;
    }
    state.remaining -= dt * state.gameSecondsPerRealSecond;
    if (state.penalty) {
      state.penalty.remaining -= dt * state.gameSecondsPerRealSecond;
      if (state.penalty.remaining <= 0) {
        state.penalty = null;
        toast("Fin de pénalité : équipes au complet");
      }
    }
    if (state.remaining <= 0) { state.remaining = 0; endPeriod(); return; }
    playerAI(dt, now);
    const side = Number(state.pressed.has(state.bindings.right)) - Number(state.pressed.has(state.bindings.left)) + state.touch.x;
    const forward = Number(state.pressed.has(state.bindings.up) || state.pressed.has("arrowup")) - Number(state.pressed.has(state.bindings.down) || state.pressed.has("arrowdown")) - state.touch.y;
    const turn = Number(state.pressed.has("arrowright")) - Number(state.pressed.has("arrowleft"));
    if (turn !== 0) {
      state.userRef.yaw = state.userRef.yaw + turn * dt * .85;
      state.facingX = Math.sin(state.userRef.yaw);
      state.facingZ = Math.cos(state.userRef.yaw);
    }
    const forwardX = state.facingX, forwardZ = state.facingZ;
    const moveX = forwardX * forward + forwardZ * side;
    const moveY = forwardZ * forward - forwardX * side;
    const length = Math.hypot(moveX, moveY);
    if (length > 0) {
      const dx = moveX / Math.max(1, length), dy = moveY / Math.max(1, length);
      state.userRef.vx = dx * state.userRef.speed;
      state.userRef.vy = dy * state.userRef.speed;
      state.facingX = dx;
      state.facingZ = dy;
      state.userRef.yaw = approachAngle(state.userRef.yaw, Math.atan2(dx, dy), dt * 2.2);
      state.userRef.x = clamp(state.userRef.x + state.userRef.vx * dt, RINK.left + 24, RINK.right - 24);
      state.userRef.y = clamp(state.userRef.y + state.userRef.vy * dt, RINK.top + 24, RINK.bottom - 24);
    } else {
      state.userRef.vx *= .72; state.userRef.vy *= .72;
    }
    state.camera.x += (state.userRef.x - state.camera.x) * Math.min(1, dt * 4);
    state.camera.y += (state.userRef.y - state.camera.y) * Math.min(1, dt * 4);
    state.camera.yaw = approachAngle(state.camera.yaw, state.userRef.yaw, dt * 0.75);
    updateScoreboard();
  }

  function endPeriod() {
    state.running = false;
    const final = state.period >= 3;
    if (final) {
      state.gameOver = true;
      state.career.matches++;
      state.career.correct += state.correct;
      state.career.xp += 30;
      save();
    }
    ui.resultEyebrow.textContent = final ? "FIN DU MATCH" : `FIN DE LA ${state.period}${state.period === 1 ? "re" : "e"} PÉRIODE`;
    ui.resultTitle.textContent = final ? "Coup de sifflet final !" : "Belle période !";
    ui.resultCopy.textContent = final
      ? `Match terminé : ${state.score[0]} — ${state.score[1]}. Tu as gagné ${state.points + 30} XP et ta carrière est sauvegardée.`
      : `Score actuel : ${state.score[0]} — ${state.score[1]}. Prépare-toi pour la période suivante.`;
    ui.resultStats.innerHTML = `<div><b>${state.decisions ? Math.round(state.correct / state.decisions * 100) : "—"}${state.decisions ? "%" : ""}</b><small>PRÉCISION</small></div><div><b>${state.correct}/${state.decisions}</b><small>BONNES DÉCISIONS</small></div><div><b>+${state.points + (final ? 30 : 0)}</b><small>XP DU MATCH</small></div>`;
    document.querySelector("#period-continue").textContent = final ? "Rejouer le match →" : "Période suivante →";
    ui.periodDialog.showModal();
    updateScoreboard();
  }

  function continueAfterPeriod() {
    ui.periodDialog.close();
    if (state.gameOver) {
      state.score = [0, 0]; state.period = 1; state.remaining = 1200;
      state.gameOver = false; state.decisions = 0; state.correct = 0; state.points = 0; state.incidents = 0; state.lastIncidentAt = -100;
      state.attackToRight = true;
      resetPlayers();
    } else {
      state.period++;
      state.remaining = 1200;
      state.attackToRight = !state.attackToRight;
      state.players.forEach(p => { p.x = WORLD.width - p.x; p.y = WORLD.height - p.y; p.homeX = p.x; p.homeY = p.y; });
      state.refs.forEach(r => { r.x = WORLD.width - r.x; r.y = WORLD.height - r.y; r.yaw += Math.PI; });
      state.facingX *= -1;
      state.facingZ *= -1;
      state.camera.x = state.userRef.x; state.camera.y = state.userRef.y;
      giveFaceoff(WORLD.centerX, WORLD.centerY);
    }
    state.running = true;
    updateScoreboard();
  }

  function togglePause() {
    if (state.gameOver || state.pending) return;
    state.running = !state.running;
    document.querySelector("#pause-button").innerHTML = state.running ? "<span>Ⅱ</span> Pause" : "<span>▶</span> Reprendre";
    updateScoreboard();
  }

  function toast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 1800);
  }

  function createRenderer(context) {
    const vertexSource = `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      uniform mat4 uViewProjection;
      uniform mat4 uModel;
      varying float vLight;
      void main() {
        vec3 normal = normalize(mat3(uModel) * aNormal);
        vLight = 0.4 + 0.6 * max(dot(normal, normalize(vec3(-0.45, 0.82, 0.36))), 0.0);
        gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
      }
    `;
    const fragmentSource = `
      precision mediump float;
      uniform vec3 uColor;
      varying float vLight;
      void main() { gl_FragColor = vec4(uColor * vLight, 1.0); }
    `;
    const program = linkProgram(context, vertexSource, fragmentSource);
    const loc = {
      position: context.getAttribLocation(program, "aPosition"),
      normal: context.getAttribLocation(program, "aNormal"),
      viewProjection: context.getUniformLocation(program, "uViewProjection"),
      model: context.getUniformLocation(program, "uModel"),
      color: context.getUniformLocation(program, "uColor"),
    };
    const meshes = {
      box: uploadGeometry(context, makeBox()),
      sphere: uploadGeometry(context, makeSphere()),
      cylinder: uploadGeometry(context, makeCylinder(false)),
      ring: uploadGeometry(context, makeRing()),
      referee: null,
    };
    const viewProjection = new Float32Array(16);
    context.enable(context.DEPTH_TEST);
    context.depthFunc(context.LEQUAL);
    context.disable(context.CULL_FACE);

    function resize(width, height) { context.viewport(0, 0, width, height); }

    async function loadRefereeModel(url) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        const positions = [];
        const normals = [];
        const vertexNormals = [];
        const indices = [];
        text.split(/\r?\n/).forEach(line => {
          const parts = line.trim().split(/\s+/);
          if (parts[0] === "v") positions.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
          if (parts[0] === "vn") normals.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
        });
        text.split(/\r?\n/).forEach(line => {
          const parts = line.trim().split(/\s+/);
          if (parts[0] !== "f") return;
          const face = parts.slice(1).map(token => token.split("/").map(Number));
          for (let i = 1; i < face.length - 1; i++) {
            [face[0], face[i], face[i + 1]].forEach(([vertexIndex, , normalIndex]) => {
              const position = positions[vertexIndex - 1];
              const normal = normals[(normalIndex || 1) - 1] || [0, 1, 0];
              indices.push(vertexIndex - 1);
              vertexNormals[vertexIndex - 1] = normal;
            });
          }
        });
        const vertices = [];
        positions.forEach((position, index) => {
          const normal = vertexNormals[index] || [0, 1, 0];
          vertices.push(position[0], position[1], position[2], ...normal);
        });
        meshes.referee = uploadGeometry(context, { vertices, indices });
      } catch (error) {
        console.warn("Le modèle 3D de l'arbitre n'a pas pu être chargé.", error);
      }
    }

    function modelMatrix(x, y, z, sx, sy, sz, yaw = 0) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      return new Float32Array([
        c*sx, 0, -s*sx, 0,
        0, sy, 0, 0,
        s*sz, 0, c*sz, 0,
        x, y, z, 1,
      ]);
    }

    function draw(mesh, x, y, z, sx, sy, sz, color, yaw = 0, customMatrix = null) {
      const model = customMatrix || modelMatrix(x, y, z, sx, sy, sz, yaw);
      context.bindBuffer(context.ARRAY_BUFFER, mesh.vertices);
      context.enableVertexAttribArray(loc.position);
      context.vertexAttribPointer(loc.position, 3, context.FLOAT, false, 24, 0);
      context.enableVertexAttribArray(loc.normal);
      context.vertexAttribPointer(loc.normal, 3, context.FLOAT, false, 24, 12);
      context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, mesh.indices);
      context.uniformMatrix4fv(loc.model, false, model);
      context.uniform3fv(loc.color, color);
      context.drawElements(context.TRIANGLES, mesh.count, context.UNSIGNED_SHORT, 0);
    }

    function box(x, y, z, sx, sy, sz, color, yaw = 0) {
      draw(meshes.box, x, y, z, sx, sy, sz, color, yaw);
    }

    function sphere(x, y, z, sx, sy, sz, color) {
      draw(meshes.sphere, x, y, z, sx, sy, sz, color);
    }

    function cylinder(x, y, z, radius, height, color) {
      draw(meshes.cylinder, x, y, z, radius, height, radius, color);
    }

    function beam(a, b, width, depth, color) {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const length = Math.hypot(dx, dy, dz) || 1;
      const up = [dx / length, dy / length, dz / length];
      let right = [up[2], 0, -up[0]];
      let rightLength = Math.hypot(right[0], right[2]);
      if (rightLength < .001) { right = [1, 0, 0]; rightLength = 1; }
      right = [right[0] / rightLength, 0, right[2] / rightLength];
      const forward = [
        right[1] * up[2] - right[2] * up[1],
        right[2] * up[0] - right[0] * up[2],
        right[0] * up[1] - right[1] * up[0],
      ];
      const matrix = new Float32Array([
        right[0] * width, right[1] * width, right[2] * width, 0,
        up[0] * length, up[1] * length, up[2] * length, 0,
        forward[0] * depth, forward[1] * depth, forward[2] * depth, 0,
        (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 1,
      ]);
      draw(meshes.box, 0, 0, 0, 1, 1, 1, color, 0, matrix);
    }

    function world(x, z, height = 0) {
      return [(x - WORLD.centerX) * .05, height, (z - WORLD.centerY) * .05];
    }

    function rinkLine(x1, z1, x2, z2, thickness, color) {
      beam(world(x1, z1, -.008), world(x2, z2, -.008), thickness, .018, color);
    }

    function rinkCircle(x, z, radius, color) {
      const p = world(x, z, -.006);
      draw(meshes.ring, p[0], p[1], p[2], radius * .05, .02, radius * .05, color);
    }

    function drawGoal(x, direction) {
      const gx = (x - WORLD.centerX) * .05;
      const depth = direction * .95;
      const red = [0.88, 0.2, 0.17];
      box(gx + depth * .5, .47, -.92, .055, .95, .055, red);
      box(gx + depth * .5, .47, .92, .055, .95, .055, red);
      box(gx + depth, .94, 0, .055, .055, 1.88, red);
      box(gx, .47, 0, .12, .035, 1.88, [0.95, 0.96, 0.92]);
      box(gx + depth, .45, -.91, .055, .8, .055, [0.82, 0.87, 0.84]);
      box(gx + depth, .45, .91, .055, .8, .055, [0.82, 0.87, 0.84]);
    }

    function drawRink() {
      const width = (RINK.right - RINK.left) * .05;
      const depth = (RINK.bottom - RINK.top) * .05;
      const centerX = ((RINK.left + RINK.right) / 2 - WORLD.centerX) * .05;
      const centerZ = ((RINK.top + RINK.bottom) / 2 - WORLD.centerY) * .05;
      box(centerX, -.18, centerZ, width, .32, depth, [0.73, 0.88, 0.9]);
      box(centerX, .16, centerZ - depth / 2 - .18, width + .5, .68, .34, [0.88, 0.91, 0.88]);
      box(centerX, .52, centerZ - depth / 2 - .18, width + .5, .07, .35, [0.87, 0.19, 0.16]);
      box(centerX, .16, centerZ + depth / 2 + .18, width + .5, .68, .34, [0.88, 0.91, 0.88]);
      box(centerX, .52, centerZ + depth / 2 + .18, width + .5, .07, .35, [0.87, 0.19, 0.16]);
      box(centerX - width / 2 - .18, .16, centerZ, .34, .68, depth, [0.88, 0.91, 0.88]);
      box(centerX - width / 2 - .18, .52, centerZ, .35, .07, depth, [0.87, 0.19, 0.16]);
      box(centerX + width / 2 + .18, .16, centerZ, .34, .68, depth, [0.88, 0.91, 0.88]);
      box(centerX + width / 2 + .18, .52, centerZ, .35, .07, depth, [0.87, 0.19, 0.16]);

      const blue = [0.11, 0.37, 0.64];
      const red = [0.79, 0.18, 0.16];
      rinkLine(RINK.blueLeft, RINK.top, RINK.blueLeft, RINK.bottom, .16, blue);
      rinkLine(RINK.blueRight, RINK.top, RINK.blueRight, RINK.bottom, .16, blue);
      rinkLine(WORLD.centerX, RINK.top, WORLD.centerX, RINK.bottom, .13, red);
      rinkLine(RINK.goalLeft, RINK.top, RINK.goalLeft, RINK.bottom, .07, red);
      rinkLine(RINK.goalRight, RINK.top, RINK.goalRight, RINK.bottom, .07, red);
      rinkCircle(WORLD.centerX, WORLD.centerY, 65, red);
      rinkCircle(RINK.goalLeft + 15, WORLD.centerY, 62, [0.13, 0.36, 0.55]);
      rinkCircle(RINK.goalRight - 15, WORLD.centerY, 62, [0.13, 0.36, 0.55]);
      [[RINK.goalLeft + 135, RINK.top + 113], [RINK.goalLeft + 135, RINK.bottom - 113], [RINK.goalRight - 135, RINK.top + 113], [RINK.goalRight - 135, RINK.bottom - 113]].forEach(([x, z]) => {
        rinkCircle(x, z, 42, [0.74, 0.25, 0.22]);
        const dot = world(x, z, .01);
        cylinder(dot[0], dot[1], dot[2], .095, .028, red);
      });
      cylinder(0, .01, 0, .105, .02, red);
      drawGoal(RINK.goalLeft, -1);
      drawGoal(RINK.goalRight, 1);
    }

    function localWorld(entity, x, z, height) {
      const yaw = entity.yaw || 0;
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      return world(entity.x + x * cos + z * sin, entity.y - x * sin + z * cos, height);
    }

    function localBox(entity, x, y, z, sx, sy, sz, color) {
      const p = localWorld(entity, x, z, y);
      box(p[0], p[1], p[2], sx, sy, sz, color, entity.yaw || 0);
    }

    function localSphere(entity, x, y, z, sx, sy, sz, color) {
      const p = localWorld(entity, x, z, y);
      sphere(p[0], p[1], p[2], sx, sy, sz, color);
    }

    function localBeam(entity, a, b, width, depth, color) {
      beam(localWorld(entity, a[0], a[2], a[1]), localWorld(entity, b[0], b[2], b[1]), width, depth, color);
    }

    function drawHockeyPlayer(player, time, referee = false, assistant = false) {
      const jersey = assistant ? [0.76, 0.96, 0.42] : referee ? hexColor(state.uniform) : player.team === 0 ? [0.08, 0.42, 0.69] : [0.78, 0.13, 0.19];
      const black = [0.075, 0.085, 0.11];
      const skin = [0.8, 0.54, 0.37];
      const gloves = [0.1, 0.12, 0.15];
      const number = Number(player.number) || 0;
      const phase = time * 8 + number * 1.7;
      const skating = Math.min(1, Math.hypot(player.vx || 0, player.vy || 0) / 70);
      const leftStride = Math.sin(phase) * .13 * skating;
      const rightStride = Math.sin(phase + Math.PI) * .13 * skating;

      localBox(player, 0, .86, -.02, .53, .59, .34, jersey);
      localBox(player, 0, 1.12, -.005, .67, .18, .37, jersey);
      localBox(player, -.36, 1.07, .015, .18, .45, .29, referee ? black : jersey);
      localBox(player, .36, 1.07, .015, .18, .45, .29, referee ? black : jersey);
      localBox(player, 0, 1.13, .205, .24, .055, .018, referee ? [0.16, 0.19, 0.21] : [0.95, 0.96, 0.91]);
      localBox(player, -.31, 1.03, .19, .11, .26, .018, referee ? [0.9, 0.82, 0.25] : [0.96, 0.96, 0.92]);
      localBox(player, .31, 1.03, .19, .11, .26, .018, referee ? [0.9, 0.82, 0.25] : [0.96, 0.96, 0.92]);
      if (referee) {
        [-.2, -.065, .065, .2].forEach(x => {
          localBox(player, x, .88, .156, .063, .5, .022, black);
          localBox(player, x, .88, -.196, .063, .5, .022, black);
        });
        localBox(player, -.36, 1.2, .02, .19, .09, .3, [0.84, 0.15, 0.12]);
        localBox(player, .36, 1.2, .02, .19, .09, .3, [0.84, 0.15, 0.12]);
      } else {
        localBox(player, -.36, .98, .02, .19, .1, .31, [0.92, 0.91, 0.86]);
        localBox(player, .36, .98, .02, .19, .1, .31, [0.92, 0.91, 0.86]);
        localBox(player, 0, .69, .2, .31, .035, .018, [0.94, 0.92, 0.85]);
      }

      localSphere(player, -.39, .78, .08, .14, .13, .14, gloves);
      localSphere(player, .39, .78, .08, .14, .13, .14, gloves);
      localBox(player, 0, .57, -.035, .48, .17, .39, [0.075, 0.085, 0.12]);
      localBox(player, -.14, .44, -.045 + leftStride * .35, .19, .27, .23, [0.075, 0.085, 0.12]);
      localBox(player, .14, .44, -.045 + rightStride * .35, .19, .27, .23, [0.075, 0.085, 0.12]);
      localBox(player, -.15, .235, -.03 + leftStride, .16, .29, .17, referee ? black : jersey);
      localBox(player, .15, .235, -.03 + rightStride, .16, .29, .17, referee ? black : jersey);
      localBox(player, -.15, .075, .085 + leftStride, .24, .12, .4, [0.12, 0.15, 0.17]);
      localBox(player, .15, .075, .085 + rightStride, .24, .12, .4, [0.12, 0.15, 0.17]);
      localBox(player, -.15, .012, .1 + leftStride, .25, .035, .45, [0.76, 0.79, 0.76]);
      localBox(player, .15, .012, .1 + rightStride, .25, .035, .45, [0.76, 0.79, 0.76]);

      localBox(player, 0, 1.25, .005, .22, .12, .2, skin);
      localSphere(player, 0, 1.48, .035, .245, .27, .22, skin);
      localSphere(player, 0, 1.62, -.01, .29, .2, .29, black);
      localBox(player, 0, 1.70, -.01, .34, .035, .31, black);
      localBox(player, 0, 1.58, -.28, .30, .045, .055, [0.04, 0.055, 0.07]);
      localBox(player, 0, 1.51, .245, .43, .055, .035, [0.57, 0.76, 0.79]);
      localSphere(player, -.075, 1.51, .238, .026, .035, .025, [0.1, 0.12, 0.13]);
      localSphere(player, .075, 1.51, .238, .026, .035, .025, [0.1, 0.12, 0.13]);
      localBox(player, 0, 1.385, .242, .31, .026, .025, black);
      [-.11, 0, .11].forEach(x => localBox(player, x, 1.46, .264, .018, .14, .018, [0.68, 0.73, 0.73]));

      if (player.role !== "goalie") {
        localBeam(player, [-.33, .77, .12], [-.56, .42, .68], .052, .052, [0.25, 0.2, 0.16]);
        localBeam(player, [-.56, .42, .68], [-.15, .08, .98], .045, .045, [0.27, 0.22, 0.17]);
        localBeam(player, [-.15, .08, .98], [.17, .08, .99], .085, .06, [0.12, 0.14, 0.15]);
      } else {
        localBox(player, -.34, .44, .1, .3, .46, .26, [0.91, 0.9, 0.86]);
        localBox(player, .34, .44, .1, .3, .46, .26, [0.91, 0.9, 0.86]);
      }
    }

    function drawPuck() {
      const p = world(state.puck.x, state.puck.y, .075);
      cylinder(p[0], p[1], p[2], .16, .12, [0.08, 0.095, 0.1]);
    }

    function drawRefereeModel(entity, assistant = false) {
      if (!meshes.referee) return false;
      const p = world(entity.x, entity.y, 0);
      const color = assistant ? [0.76, 0.96, 0.42] : hexColor(state.uniform);
      draw(meshes.referee, p[0], p[1], p[2], 1, 1, 1, color, entity.yaw || 0);
      return true;
    }

    function render(time) {
      if (!context.canvas.width || !context.canvas.height) return;
      context.clearColor(0.035, 0.09, 0.13, 1);
      context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);
      context.useProgram(program);
      const user = world(state.userRef.x, state.userRef.y, 0);
      let eye, target, up = [0, 1, 0];
      if (state.cameraView === "overhead") {
        eye = [0, 73, 22];
        target = [0, 0, 0];
        up = [0, 0, -1];
      } else {
        const fx = Math.sin(state.camera.yaw), fz = Math.cos(state.camera.yaw);
        eye = [user[0] - fx * 6.4, 3.2, user[2] - fz * 6.4];
        target = [user[0] + fx * 3.6, .75, user[2] + fz * 3.6];
      }
      const view = lookAt(eye, target, up);
      const projection = perspective(Math.PI / 3.2, context.canvas.width / context.canvas.height, .1, 140);
      multiplyMatrix(viewProjection, projection, view);
      context.uniformMatrix4fv(loc.viewProjection, false, viewProjection);

      drawRink();
      const seconds = time / 1000;
      state.players.forEach(player => drawHockeyPlayer(player, seconds));
      if (!drawRefereeModel(state.refs[1], true)) drawHockeyPlayer(state.refs[1], seconds, true, true);
      if (!drawRefereeModel(state.userRef, false)) drawHockeyPlayer(state.userRef, seconds, true, false);
      drawPuck();
    }

    return { resize, render, loadRefereeModel };
  }

  function linkProgram(context, vertexSource, fragmentSource) {
    const compile = (type, source) => {
      const shader = context.createShader(type);
      context.shaderSource(shader, source);
      context.compileShader(shader);
      if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
        const message = context.getShaderInfoLog(shader);
        context.deleteShader(shader);
        throw new Error(`Impossible de compiler le rendu 3D : ${message}`);
      }
      return shader;
    };
    const program = context.createProgram();
    context.attachShader(program, compile(context.VERTEX_SHADER, vertexSource));
    context.attachShader(program, compile(context.FRAGMENT_SHADER, fragmentSource));
    context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) {
      const message = context.getProgramInfoLog(program);
      context.deleteProgram(program);
      throw new Error(`Impossible de démarrer le rendu 3D : ${message}`);
    }
    return program;
  }

  function uploadGeometry(context, data) {
    const vertices = context.createBuffer();
    context.bindBuffer(context.ARRAY_BUFFER, vertices);
    context.bufferData(context.ARRAY_BUFFER, new Float32Array(data.vertices), context.STATIC_DRAW);
    const indices = context.createBuffer();
    context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indices);
    context.bufferData(context.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices), context.STATIC_DRAW);
    return { vertices, indices, count: data.indices.length };
  }

  function makeBox() {
    const vertices = [], indices = [];
    const faces = [
      [[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5],[0,0,1]],
      [[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5],[0,0,-1]],
      [[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5],[1,0,0]],
      [[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5],[-1,0,0]],
      [[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5],[0,1,0]],
      [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5],[0,-1,0]],
    ];
    faces.forEach((face, index) => {
      const start = index * 4;
      face.slice(0, 4).forEach(point => vertices.push(...point, ...face[4]));
      indices.push(start,start+1,start+2,start,start+2,start+3);
    });
    return { vertices, indices };
  }

  function makeSphere() {
    const vertices = [], indices = [];
    const slices = 12, stacks = 8;
    for (let y = 0; y <= stacks; y++) {
      const phi = y / stacks * Math.PI;
      for (let x = 0; x <= slices; x++) {
        const theta = x / slices * Math.PI * 2;
        const nx = Math.sin(phi) * Math.cos(theta), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(theta);
        vertices.push(nx, ny, nz, nx, ny, nz);
      }
    }
    for (let y = 0; y < stacks; y++) {
      for (let x = 0; x < slices; x++) {
        const a = y * (slices + 1) + x, b = a + slices + 1;
        indices.push(a,a+1,b,a+1,b+1,b);
      }
    }
    return { vertices, indices };
  }

  function makeCylinder() {
    const vertices = [], indices = [];
    const segments = 12;
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * Math.PI * 2, x = Math.cos(angle), z = Math.sin(angle);
      vertices.push(x * .5, -.5, z * .5, x, 0, z);
      vertices.push(x * .5, .5, z * .5, x, 0, z);
    }
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      indices.push(a,a+2,a+1,a+1,a+2,a+3);
    }
    const topCenter = vertices.length / 6;
    vertices.push(0,.5,0,0,1,0);
    const bottomCenter = topCenter + 1;
    vertices.push(0,-.5,0,0,-1,0);
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * Math.PI * 2, x = Math.cos(angle), z = Math.sin(angle);
      vertices.push(x * .5,.5,z * .5,0,1,0);
      vertices.push(x * .5,-.5,z * .5,0,-1,0);
    }
    for (let i = 0; i < segments; i++) {
      const topA = topCenter + 2 + i * 2;
      const bottomA = topCenter + 3 + i * 2;
      indices.push(topCenter,topA,topA+2,bottomCenter,bottomA+2,bottomA);
    }
    return { vertices, indices };
  }

  function makeRing() {
    const vertices = [], indices = [];
    const segments = 48;
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
      vertices.push(c, 0, s, 0, 1, 0, c * .94, 0, s * .94, 0, 1, 0);
    }
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      indices.push(a,a+1,a+2,a+1,a+3,a+2);
    }
    return { vertices, indices };
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
    return new Float32Array([
      f / aspect,0,0,0,
      0,f,0,0,
      0,0,(far + near) * nf,-1,
      0,0,2 * far * near * nf,0,
    ]);
  }

  function lookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let length = Math.hypot(zx, zy, zz) || 1;
    zx /= length; zy /= length; zz /= length;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    length = Math.hypot(xx, xy, xz) || 1;
    xx /= length; xy /= length; xz /= length;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx,yx,zx,0,
      xy,yy,zy,0,
      xz,yz,zz,0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),1,
    ]);
  }

  function multiplyMatrix(out, a, b) {
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        out[column * 4 + row] =
          a[row] * b[column * 4] +
          a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] +
          a[12 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }

  function hexColor(hex) {
    const value = /^#[\da-f]{6}$/i.test(hex) ? hex : "#f4f4f0";
    return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16) / 255);
  }

  function loop(timestamp) {
    const now = timestamp / 1000;
    state.dt = Math.min(.04, state.lastFrame ? now - state.lastFrame : 0);
    state.lastFrame = now;
    tick(state.dt, now);
    if (renderer) renderer.render(timestamp);
    requestAnimationFrame(loop);
  }

  function isEditable(target) { return ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName); }
  function codeToKey(event) { return event.key === " " ? " " : event.key.toLowerCase(); }
  function openWhistle() {
    if (ui.whistleDialog.open) return;
    ui.whistleContext.textContent = state.pending
      ? `${state.pending.title} — choisis la règle que tu appliques.`
      : "Justifie ton sifflet : indique si une infraction est observée.";
    ui.whistleDialog.showModal();
  }

  window.addEventListener("keydown", event => {
    const key = codeToKey(event);
    if (state.listeningFor) {
      event.preventDefault();
      if (key === "escape") { state.listeningFor = null; renderBindings(); return; }
      if (Object.entries(state.bindings).some(([action, value]) => action !== state.listeningFor && value === key)) {
        toast("Cette touche est déjà attribuée");
        return;
      }
      state.bindings[state.listeningFor] = key;
      state.listeningFor = null;
      save(); renderBindings();
      return;
    }
    if (isEditable(event.target)) return;
    if (ui.whistleDialog.open) {
      if (!event.repeat && ["1","2","3","4","5","0"].includes(key)) {
        const map = { "1":"offside", "2":"icing", "3":"penalty", "4":"goal", "5":"no-goal", "0":"play-on" };
        makeCall(map[key]);
      }
      if (key === "escape") ui.whistleDialog.close();
      event.preventDefault();
      return;
    }
    state.pressed.add(key);
    if (Object.keys(state.bindings).some(action => action !== "whistle" && state.bindings[action] === key) || key === "arrowup" || key === "arrowdown" || key === "arrowleft" || key === "arrowright") event.preventDefault();
    if (key === state.bindings.whistle && !event.repeat) openWhistle();
    if (!event.repeat && ["1","2","3","4","5","0"].includes(key)) {
      const map = { "1":"offside", "2":"icing", "3":"penalty", "4":"goal", "5":"no-goal", "0":"play-on" };
      makeCall(map[key]);
    }
    if (!event.repeat && key === "escape") togglePause();
  });
  window.addEventListener("keyup", event => state.pressed.delete(codeToKey(event)));
  window.addEventListener("blur", () => state.pressed.clear());
  document.querySelectorAll(".decision-button").forEach(button => button.addEventListener("click", () => makeCall(button.dataset.call)));
  document.querySelector("#pause-button").addEventListener("click", togglePause);
  document.querySelector("#period-continue").addEventListener("click", continueAfterPeriod);
  document.querySelector("#settings-open").addEventListener("click", () => ui.settings.showModal());
  document.querySelector("#camera-toggle").addEventListener("click", () => {
    state.cameraView = state.cameraView === "chase" ? "overhead" : "chase";
    ui.cameraMode.textContent = state.cameraView === "chase" ? "VUE 3E PERSONNE" : "VUE AÉRIENNE";
  });
  document.querySelector("#uniform-color").addEventListener("change", event => { state.uniform = event.target.value; save(); });
  document.querySelector("#reset-bindings").addEventListener("click", () => { state.bindings = { ...defaults }; state.listeningFor = null; save(); renderBindings(); });
  document.querySelector("#mobile-help").addEventListener("click", () => toast("Déplace-toi avec le joystick dans la patinoire."));
  document.querySelector("#touch-whistle").addEventListener("click", openWhistle);
  document.querySelectorAll("[data-bind]").forEach(button => button.addEventListener("click", () => {
    state.listeningFor = button.dataset.bind;
    renderBindings();
  }));
  window.addEventListener("resize", resize);

  function renderBindings() {
    document.querySelectorAll("[data-bind]").forEach(button => {
      const action = button.dataset.bind;
      const labels = { up: "Avancer", down: "Reculer", left: "Aller à gauche", right: "Aller à droite", whistle: "Siffler" };
      const display = state.bindings[action] === " " ? "Espace" : state.bindings[action].length === 1 ? state.bindings[action].toUpperCase() : state.bindings[action];
      const listening = state.listeningFor === action;
      button.classList.toggle("listening", listening);
      button.innerHTML = `${labels[action]} <kbd>${listening ? "Appuie…" : display}</kbd>`;
    });
    document.querySelectorAll("[data-keyhint]").forEach(keyHint => {
      const key = state.bindings[keyHint.dataset.keyhint];
      keyHint.textContent = key === " " ? "Espace" : key.length === 1 ? key.toUpperCase() : key;
    });
  }

  const joystick = document.querySelector("#joystick");
  const knob = document.querySelector("#joystick-knob");
  function joystickMove(event) {
    const rect = joystick.getBoundingClientRect();
    const max = rect.width * .32;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    const scale = Math.min(1, max / len);
    const x = dx * scale, y = dy * scale;
    knob.style.transform = `translate(${x}px,${y}px)`;
    state.touch.x = x / max; state.touch.y = y / max; state.touch.active = true;
  }
  joystick.addEventListener("pointerdown", event => { joystick.setPointerCapture(event.pointerId); state.touch.pointer = event.pointerId; joystickMove(event); });
  joystick.addEventListener("pointermove", event => { if (state.touch.pointer === event.pointerId) joystickMove(event); });
  const resetJoystick = () => { state.touch.pointer = null; state.touch.x = 0; state.touch.y = 0; state.touch.active = false; knob.style.transform = "translate(0,0)"; };
  joystick.addEventListener("pointerup", resetJoystick);
  joystick.addEventListener("pointercancel", resetJoystick);

  state.uniform = state.uniform;
  ui.uniform.value = state.uniform;
  if (!gl) {
    console.error("Ce navigateur n'a pas activé WebGL; le rendu 3D ne peut pas démarrer.");
    toast("Active WebGL dans ton navigateur pour afficher le match 3D.");
  }
  resetPlayers();
  renderBindings();
  resize();
  updateScoreboard();
  if (renderer) renderer.loadRefereeModel("assets/referee-model/base.obj");
  requestAnimationFrame(loop);
})();
