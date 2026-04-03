import { useEffect, useRef, useState } from "react";
import { Invitation, Inviter, Registerer, RegistererState, Session, SessionState, UserAgent } from "sip.js";
import { StatusBadge } from "./components/StatusBadge";

type ConnectionState = "idle" | "connecting" | "registered" | "error";
type CallPhase = "idle" | "ringing-in" | "ringing-out" | "active";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface AuthUser {
  name: string;
  extension: string;
  sipPassword: string;
  token: string;
}

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches;

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const DOMAIN = window.location.hostname;
const WSS = `wss://${window.location.hostname}/ws`;
const dialPad = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
  ["*", ""],
  ["0", "+"],
  ["#", ""],
] as const;
const quickTargets = [
  { label: "Ramal 1001", value: "1001" },
  { label: "Ramal 1002", value: "1002" },
  { label: "Eco 2000", value: "2000" },
  { label: "Demo 3000", value: "3000" },
];

function App() {
  // ── Auth state ────────────────────────────────────────────
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // ── SIP / call state ──────────────────────────────────────
  const [target, setTarget] = useState("");
  const [status, setStatus] = useState<ConnectionState>("idle");
  const [statusText, setStatusText] = useState("Desconectado");
  const [callPhase, setCallPhase] = useState<CallPhase>("idle");
  const [callPeer, setCallPeer] = useState("");
  const [callDuration, setCallDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [showVideoPanel, setShowVideoPanel] = useState(false);
  const [incomingVideoOffer, setIncomingVideoOffer] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const userAgentRef = useRef<UserAgent | null>(null);
  const registererRef = useRef<Registerer | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const pendingInvitationRef = useRef<Invitation | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasRegisteredRef = useRef(false);
  const isDisconnectingRef = useRef(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [showIOSHint, setShowIOSHint] = useState(false);

  // ── Load session from localStorage on mount ──────────────
  useEffect(() => {
    const saved = localStorage.getItem("webphone_user");
    if (saved) {
      try { setAuthUser(JSON.parse(saved) as AuthUser); } catch { /* ignore */ }
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      void disconnect();
    };
  }, []);

  async function installPWA() {
    if (isIOS) { setShowIOSHint(true); return; }
    if (installPrompt) {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setInstallPrompt(null);
    } else {
      // fallback: mostra hint genérico para Chrome/Firefox sem prompt capturado
      setShowIOSHint(true);
    }
  }

  function startCallTimer() {
    setCallDuration(0);
    callTimerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
  }

  function stopCallTimer() {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    setCallDuration(0);
  }

  async function connect() {
    if (!authUser || status === "connecting" || status === "registered") return;
    try {
      setStatus("connecting");
      setStatusText("Conectando ao PBX...");

      const sipUri = `sip:${authUser.extension}@${DOMAIN}`;
      const uri = UserAgent.makeURI(sipUri);
      if (!uri) throw new Error("URI SIP inválida.");

      const userAgent = new UserAgent({
        uri,
        displayName: authUser.name,
        authorizationUsername: authUser.extension,
        authorizationPassword: authUser.sipPassword,
        transportOptions: { server: WSS },
        sessionDescriptionHandlerFactoryOptions: {
          constraints: { audio: true, video: videoEnabled },
        },
        delegate: {
          onInvite: (invitation: Invitation) => {
            pendingInvitationRef.current = invitation;
            setIncomingVideoOffer(invitationHasVideo(invitation));
            setCallPeer(invitation.remoteIdentity.uri.user ?? "Desconhecido");
            setCallPhase("ringing-in");
            invitation.stateChange.addListener((state) => {
              if (state === SessionState.Terminated) {
                pendingInvitationRef.current = null;
                setCallPhase("idle");
                setCallPeer("");
                setIncomingVideoOffer(false);
                stopCallTimer();
              }
            });
          },
        },
      });

      userAgentRef.current = userAgent;
      await userAgent.start();

      const registerer = new Registerer(userAgent);
      registererRef.current = registerer;
      registerer.stateChange.addListener((nextState) => {
        if (nextState === RegistererState.Registered) {
          wasRegisteredRef.current = true;
          setStatus("registered");
          setStatusText(`Registrado como ramal ${authUser.extension}`);
        } else if (nextState === RegistererState.Unregistered) {
          if (isDisconnectingRef.current) return;
          setStatus("error");
          setStatusText(
            wasRegisteredRef.current
              ? "Registro perdido. Reconecte."
              : "Falha ao registrar. Verifique credenciais."
          );
        }
      });

      await registerer.register().catch((err: unknown) => {
        throw err instanceof Error ? err : new Error("Falha no registro SIP.");
      });
    } catch (error) {
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : "Falha ao registrar no PBX.");
    }
  }

  async function disconnect() {
    isDisconnectingRef.current = true;
    wasRegisteredRef.current = false;
    stopCallTimer();
    clearMediaElements();
    pendingInvitationRef.current = null;
    const session = sessionRef.current;
    if (session && session.state !== SessionState.Terminated) {
      await session.bye().catch(() => undefined);
    }
    sessionRef.current = null;
    if (registererRef.current) {
      await registererRef.current.unregister().catch(() => undefined);
      registererRef.current = null;
    }
    if (userAgentRef.current) {
      await userAgentRef.current.stop().catch(() => undefined);
      userAgentRef.current = null;
    }
    setStatus("idle");
    setStatusText("Desconectado");
    setCallPhase("idle");
    setCallPeer("");
    setShowVideoPanel(false);
    setIncomingVideoOffer(false);
    setMuted(false);
    isDisconnectingRef.current = false;
  }

  async function answerCall() {
    const invitation = pendingInvitationRef.current;
    if (!invitation) return;
    bindSession(invitation);
    const shouldAnswerWithVideo = videoEnabled || incomingVideoOffer;
    await invitation.accept({
      sessionDescriptionHandlerOptions: { constraints: { audio: true, video: shouldAnswerWithVideo } },
    });
    pendingInvitationRef.current = null;
    setIncomingVideoOffer(false);
  }

  async function rejectCall() {
    const invitation = pendingInvitationRef.current;
    if (!invitation) return;
    await invitation.reject().catch(() => undefined);
    pendingInvitationRef.current = null;
    setCallPhase("idle");
    setCallPeer("");
    setIncomingVideoOffer(false);
    clearMediaElements();
  }

  async function placeCall() {
    const userAgent = userAgentRef.current;
    const dest = target.trim();
    if (!userAgent || callPhase !== "idle" || status !== "registered" || !dest) return;
    const targetUri = UserAgent.makeURI(`sip:${dest}@${DOMAIN}`);
    if (!targetUri) return;
    const inviter = new Inviter(userAgent, targetUri);
    setCallPeer(dest);
    setCallPhase("ringing-out");
    bindSession(inviter);
    try {
      await inviter.invite({
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: videoEnabled },
        },
      });
    } catch {
      setCallPhase("idle");
      setCallPeer("");
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError("");
    try {
      const body =
        authMode === "register"
          ? { name: authName, email: authEmail, password: authPassword }
          : { email: authEmail, password: authPassword };
      const res = await fetch(`/api/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        error?: string;
        name: string;
        extension: string | number;
        sip_password: string;
        token: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Erro desconhecido");
      const user: AuthUser = {
        name: data.name,
        extension: String(data.extension),
        sipPassword: data.sip_password,
        token: data.token,
      };
      localStorage.setItem("webphone_user", JSON.stringify(user));
      setAuthUser(user);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Erro ao autenticar");
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    await disconnect();
    localStorage.removeItem("webphone_user");
    setAuthUser(null);
    setStatus("idle");
    setStatusText("Desconectado");
  }

  async function hangup() {
    const session = sessionRef.current;
    if (!session) return;
    await terminateSession(session);
    stopCallTimer();
    setCallPhase("idle");
    setCallPeer("");
    setShowVideoPanel(false);
    setIncomingVideoOffer(false);
    setMuted(false);
    clearMediaElements();
    sessionRef.current = null;
  }

  function toggleMute() {
    const pc = getPeerConnection(sessionRef.current);
    if (!pc) {
      return;
    }

    pc.getSenders().forEach((sender) => {
      if (sender.track?.kind === "audio") {
        sender.track.enabled = muted;
      }
    });
    setMuted((current) => !current);
  }

  function bindSession(session: Session) {
    sessionRef.current = session;
    const peerConnection = getPeerConnection(session);

    if (peerConnection) {
      peerConnection.ontrack = () => {
        attachMedia(session);
      };

      peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === "connected") {
          attachMedia(session);
        }
      };
    }

    session.stateChange.addListener((nextState) => {
      if (nextState === SessionState.Established) {
        setCallPhase("active");
        startCallTimer();
        attachMedia(session);
      }
      if (nextState === SessionState.Terminated) {
        stopCallTimer();
        setCallPhase("idle");
        setCallPeer("");
        setShowVideoPanel(false);
        setIncomingVideoOffer(false);
        setMuted(false);
        clearMediaElements();
        sessionRef.current = null;
      }
    });
  }

  function attachMedia(session: Session) {
    const peerConnection = getPeerConnection(session);
    if (!peerConnection || !audioRef.current) {
      return;
    }

    const remoteStream = new MediaStream();
    let hasRemoteVideo = false;

    peerConnection.getReceivers().forEach((receiver) => {
      if (receiver.track) {
        remoteStream.addTrack(receiver.track);
        if (receiver.track.kind === "video") {
          hasRemoteVideo = true;
        }
      }
    });

    audioRef.current.srcObject = remoteStream;
    void audioRef.current.play().catch(() => undefined);

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      if (hasRemoteVideo) {
        void remoteVideoRef.current.play().catch(() => undefined);
      }
    }

    const localStream = new MediaStream();
    let hasLocalVideo = false;

    peerConnection.getSenders().forEach((sender) => {
      if (sender.track) {
        localStream.addTrack(sender.track);
        if (sender.track.kind === "video") {
          hasLocalVideo = true;
        }
      }
    });

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
      if (hasLocalVideo) {
        void localVideoRef.current.play().catch(() => undefined);
      }
    }

    setShowVideoPanel(hasRemoteVideo || hasLocalVideo);
  }

  function getPeerConnection(session: Session | null) {
    return (session as Session & { sessionDescriptionHandler?: { peerConnection?: RTCPeerConnection } })
      ?.sessionDescriptionHandler?.peerConnection;
  }

  function clearMediaElements() {
    clearMediaElement(audioRef.current, true);
    clearMediaElement(remoteVideoRef.current, true);
    clearMediaElement(localVideoRef.current, false);
  }

  function clearMediaElement(element: HTMLMediaElement | null, stopTracks: boolean) {
    if (!element) {
      return;
    }

    const stream = element.srcObject;
    if (stopTracks && stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    element.pause();
    element.srcObject = null;
  }

  function invitationHasVideo(invitation: Invitation) {
    const body = invitation.request.body;
    return typeof body === "string" && /\bm=video\b/i.test(body);
  }

  async function terminateSession(session: Session) {
    const candidate = session as Session & {
      bye?: () => Promise<void>;
      cancel?: () => Promise<void>;
      dispose?: () => void;
    };

    if (session.state === SessionState.Established && candidate.bye) {
      await candidate.bye().catch(() => undefined);
      return;
    }

    if (candidate.cancel) {
      await candidate.cancel().catch(() => undefined);
      return;
    }

    candidate.dispose?.();
  }

  const isRegistered = status === "registered";
  const isBusy = callPhase !== "idle";
  const canDial = isRegistered && !isBusy;
  const callTitle =
    callPhase === "ringing-in"
      ? "Chamada recebida"
      : callPhase === "ringing-out"
        ? "Chamando"
        : callPhase === "active"
          ? "Em chamada"
          : "Pronto para discar";

  function appendDigit(value: string) {
    if (!canDial) return;
    setTarget((current) => `${current}${value}`);
  }

  function backspaceTarget() {
    if (!canDial) return;
    setTarget((current) => current.slice(0, -1));
  }

  function clearTarget() {
    if (!canDial) return;
    setTarget("");
  }

  // ── Auth screen ───────────────────────────────────────────
  if (!authUser) {
    return (
      <main className="app-shell">
        <header className="app-header soft-header">
          <div>
            <span className="app-kicker">Voice Workspace</span>
            <h1 className="app-title">Console do Ramal</h1>
          </div>
          {!installed && (
            <button className="btn-install" onClick={() => void installPWA()} title="Instalar como app">
              Instalar
            </button>
          )}
        </header>

        <section className="panel auth-panel">
          <h2 className="auth-title">
            {authMode === "login" ? "Entrar" : "Criar conta"}
          </h2>
          <form className="auth-form" onSubmit={(e) => void handleAuth(e)}>
            {authMode === "register" && (
              <div className="field-group">
                <label htmlFor="auth-name">Nome</label>
                <input id="auth-name" type="text" placeholder="Seu nome completo"
                  value={authName} onChange={(e) => setAuthName(e.target.value)}
                  required autoComplete="name" />
              </div>
            )}
            <div className="field-group">
              <label htmlFor="auth-email">E-mail</label>
              <input id="auth-email" type="email" placeholder="seu@email.com"
                value={authEmail} onChange={(e) => setAuthEmail(e.target.value)}
                required autoComplete="email" />
            </div>
            <div className="field-group">
              <label htmlFor="auth-pass">Senha</label>
              <input id="auth-pass" type="password"
                placeholder={authMode === "register" ? "Mínimo 6 caracteres" : "Sua senha"}
                value={authPassword} onChange={(e) => setAuthPassword(e.target.value)}
                required autoComplete={authMode === "login" ? "current-password" : "new-password"} />
            </div>
            {authError && <p className="auth-error">{authError}</p>}
            <button type="submit" className="btn-connect btn-block" disabled={authLoading}>
              {authLoading ? "Aguarde..." : authMode === "login" ? "Entrar" : "Cadastrar"}
            </button>
          </form>
          <p className="auth-switch">
            {authMode === "login" ? "Não tem conta? " : "Já tem conta? "}
            <button className="auth-switch-btn"
              onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }}>
              {authMode === "login" ? "Cadastre-se" : "Faça login"}
            </button>
          </p>
        </section>
      </main>
    );
  }

  // ── Phone screen ──────────────────────────────────────────
  return (
    <main className="app-shell">
      <header className="app-header soft-header">
        <div>
          <span className="app-kicker">Voice Workspace</span>
          <h1 className="app-title">Console do Ramal</h1>
        </div>
        <div className="header-right">
          <StatusBadge tone={status} text={statusText} />
          {!installed && (
            <button className="btn-install" onClick={() => void installPWA()} title="Instalar como app">
              Instalar
            </button>
          )}
          <button className="btn-logout" onClick={() => void logout()} title="Sair">Sair</button>
        </div>
      </header>

      {showIOSHint && (
        <div className="ios-hint panel">
          {isIOS ? (<>
            <p><strong>iPhone / iPad:</strong></p>
            <p>Toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</p>
          </>) : (<>
            <p><strong>Chrome / Edge:</strong></p>
            <p>Use o botão de instalar do navegador ou o menu e escolha <strong>Instalar aplicativo</strong>.</p>
          </>)}
          <button className="ios-hint-close" onClick={() => setShowIOSHint(false)}>Fechar</button>
        </div>
      )}

      <section className="softphone-frame">
        <aside className="panel identity-rail">
          <div className="avatar-orb" aria-hidden>
            {authUser.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="identity-copy">
            <p className="rail-label">Ramal ativo</p>
            <h2>{authUser.extension}</h2>
            <p>{authUser.name}</p>
          </div>
          <div className="rail-actions">
            {!isRegistered ? (
              <button className="btn-connect" disabled={status === "connecting"} onClick={() => void connect()}>
                {status === "connecting" ? "Conectando..." : "Conectar ao PBX"}
              </button>
            ) : (
              <button className="btn-disconnect" onClick={() => void disconnect()}>Desconectar</button>
            )}
          </div>
          <div className="quick-targets">
            <p className="rail-label">Atalhos</p>
            {quickTargets.map((item) => (
              <button
                key={item.value}
                className="quick-target"
                disabled={!canDial}
                onClick={() => setTarget(item.value)}
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel handset">
          <div className={`call-display call-display--${callPhase}`}>
            <div className="call-display-top">
              <span className="call-state-label">{callTitle}</span>
              {callPhase === "active" && <span className="call-clock">{formatDuration(callDuration)}</span>}
            </div>
            <div className="dial-readout">
              <span className={`dial-number ${target ? "" : "dial-number--placeholder"}`}>
                {callPeer || target || "Digite um ramal"}
              </span>
              <span className="dial-caption">
                {callPeer
                  ? `Sessao com ${callPeer}`
                  : isRegistered
                    ? "Pronto para chamar outro ramal"
                    : "Conecte ao PBX para habilitar o discador"}
              </span>
            </div>

            {showVideoPanel && (
              <div className="video-stage">
                <video ref={remoteVideoRef} className="remote-video" autoPlay playsInline />
                <video ref={localVideoRef} className="local-video" autoPlay muted playsInline />
              </div>
            )}

            {isBusy ? (
              <div className="live-call-actions">
                {callPhase === "ringing-in" && (
                  <>
                    <button className="round-action round-action--danger" onClick={() => void rejectCall()}>
                      Recusar
                    </button>
                    <button className="round-action round-action--success" onClick={() => void answerCall()}>
                      Atender
                    </button>
                  </>
                )}
                {callPhase === "ringing-out" && (
                  <button className="round-action round-action--danger wide-action" onClick={() => void hangup()}>
                    Cancelar chamada
                  </button>
                )}
                {callPhase === "active" && (
                  <>
                    <button className="round-action round-action--mute" onClick={toggleMute}>
                      {muted ? "Ativar microfone" : "Mutar microfone"}
                    </button>
                    <button className="round-action round-action--danger" onClick={() => void hangup()}>
                      Encerrar
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="display-tools">
                <button
                  className={`mini-action ${videoEnabled ? "mini-action--active" : ""}`}
                  disabled={!canDial}
                  onClick={() => setVideoEnabled((current) => !current)}
                >
                  {videoEnabled ? "Video ativado" : "So audio"}
                </button>
                <button className="mini-action" disabled={!canDial || !target} onClick={backspaceTarget}>
                  Apagar
                </button>
                <button className="mini-action" disabled={!canDial || !target} onClick={clearTarget}>
                  Limpar
                </button>
              </div>
            )}
          </div>

          <div className="dialer-grid">
            {dialPad.map(([digit, letters]) => (
              <button
                key={digit}
                className="dial-key"
                disabled={!canDial}
                onClick={() => appendDigit(digit)}
              >
                <span className="dial-key-digit">{digit}</span>
                <span className="dial-key-letters">{letters}</span>
              </button>
            ))}
          </div>

          <div className="handset-footer">
            <input
              className="dial-input dial-input--hidden"
              type="tel"
              inputMode="tel"
              placeholder="Digite o número do ramal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={!canDial}
              onKeyDown={(e) => { if (e.key === "Enter") void placeCall(); }}
            />
            <button
              className="btn-call btn-call-main"
              disabled={!isRegistered || isBusy || !target.trim()}
              onClick={() => void placeCall()}
            >
              {target.trim() ? `Ligar para ${target.trim()}` : "Ligar"}
            </button>
          </div>
        </section>
      </section>

      <audio ref={audioRef} autoPlay playsInline />
    </main>
  );
}

export default App;
