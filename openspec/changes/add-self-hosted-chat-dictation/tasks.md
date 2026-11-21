# Tasks

## 1. Provision one self-hosted recognizer

- [ ] 1.1 Document and exercise the native Radeon setup in the proposal. Verify the v0.3.0 Linux x86-64 Vulkan archive checksum and pinned Nemotron 3.5 Q8 GGUF digest. Check device discovery with `nemo-speech doctor`, run the localhost playground mic trial in English and Dutch, and retain runtime evidence that the selected inference device was the RX 6800. Verify 560 ms model chunks and partial/final events, then restart offline and transcribe again with the cached weights.
- [ ] 1.2 Extend personal config, example, generated schema and operator guide with opt-in endpoint, language (auto/English/Dutch) and live/finish-only mode. Keep service credentials in the host environment where required. Check legacy configs, invalid values and read-only config validation, then prove ordinary startup with speech software absent.
- [ ] 1.3 Document the native CPU and macOS options and provide the optional NVIDIA GPU Compose file with loopback publication, read-only model mount and readiness check. Verify the Compose configuration and document which deployment paths have passed real inference.

## 2. Connect audio to the originating draft

- [ ] 2.1 Implement a bounded recording lifecycle shared by both clients with per-attempt ownership, cancellation, timeouts and single final insertion. Stream 16 kHz mono PCM16 for live mode, accumulate endpointed segments in order, and use a bounded in-memory clip for finish-only recognition. Document duration and backlog limits. Drive revised partials, repeated completions, silence, overflow, lost connections and delayed callbacks through a deterministic recognizer fixture and check cleanup.
- [ ] 2.2 Add a same-origin web relay to the configured recognizer with origin/host checks on socket upgrade, a fixed upstream, bounded queues and cancellation on disconnect. Keep audio, partial text and upstream credentials out of logs, retained workspace state and browser assets. Verify wrong-origin requests are rejected and disposing one connection leaves other connections and Abra work intact.

## 3. Add the mic to terminal and browser chat

- [ ] 3.1 Package an optional terminal-only dictation plugin and register it for the main Abra prompt when enabled. First prove on pinned OpenCode 2.3.0 that a footer click can preserve the intended editor and insert text at its current caret via a supported client-local paste path. Exercise two attached clients, focus changes and multiline text in a disposable native session and record API evidence. Preserve core plugin packaging and cover both enabled and disabled relocated installations.
- [ ] 3.2 Wire a keyboard command and clickable mic to the terminal recorder. Select and document an available Linux/macOS capture path that produces the agreed PCM format. Check native attach with the web server stopped, normal versus shell mode, missing input device, cancel during capture and finish, read-only views and recorder termination. Confirm text lands only in the intended draft and cannot execute a command or submit a message.
- [ ] 3.3 Add an accessible mic toggle, recording status and transient transcript preview to the web composer. Load capture code on use, release microphone tracks on every exit and insert through the session draft's edit path. Verify pointer and keyboard use, editing while recording, cancel, selection replacement, attachments, 32,768-character limit, intentional Send/Queue/Steer, and suppression of stale results after sending or changing session. Document the interaction for both clients.

## 4. Verify live dictation under load

- [ ] 4.1 Replay the same 30-second clip on the RX 6800 through Vulkan and on the host CPU with the same model, 560 ms setting and representative Abra workload. Compare typing alone, live preview and finish-only operation. Record the actual backend, memory and CPU/GPU load, time to first visible words, lag over the clip, stop-to-final time and input responsiveness. Use short English, Dutch and mixed coding prompts to count corrections for names and commands. Recommend a live setting for this host from the measurements, checking 320 ms if 560 ms feedback feels slow.
- [ ] 4.2 Exercise real operator mic input in each client, speech-service restart and offline reuse of the model. Retain reproducible steps, snapshots and aggregate measurements per the verification recipe. Run focused regressions, `pnpm check`, `pnpm test:all`, and strict OpenSpec validation before handoff.
