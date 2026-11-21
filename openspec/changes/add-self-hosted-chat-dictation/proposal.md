# Proposal

## Why

An operator should be able to dictate a coding prompt in English or Dutch directly into Abra chat, see what the recognizer heard, and correct project names or commands before sending. Running recognition on an operator-controlled host keeps spoken audio within that installation.

## What Changes

- Add a clickable, keyboard-operable mic to the main Abra prompt in the native terminal and beside Send in the browser. Click once to record, click again to finish, or press Escape to discard.
- Show revisable text beside the draft while typing remains available. Finishing inserts the recognized text once into the originating editable draft. Sending stays an explicit user action.
- Offer opt-in, self-hosted speech recognition using NVIDIA Nemotron 3.5 ASR Streaming 0.6B Q8 through NeMo-Speech.cpp. Start at 560 ms chunks, with automatic language detection and explicit English and Dutch choices. [Model files](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/tree/main) · [Language and latency evaluation](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b#performance)
- Verify one live stream under ordinary Abra load. Offer recognition after capture on hosts where live decoding cannot keep pace.

## Capabilities

### New Capabilities

- `chat-dictation` covers microphone capture, self-hosted recognition, live preview, and insertion into an editable chat draft.

### Modified Capabilities

## Impact

The web composer and its session draft, the terminal launcher and plugin packaging, personal configuration and its generated schema, and the workspace web server gain dictation support. The web server proxies a same-origin audio socket to the configured recognizer. The terminal client can reach the recognizer independently of the web workspace. The operator provisions the speech runtime and weights once, separately from ordinary Abra installation and startup. The Q8 model download is about 742 MB. [Runtime server](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/server.md)

## Scope and Choices

- Use a native Linux Vulkan speech server as the reference deployment. Both chat clients share one warm model on loopback. The operator can restart recognition independently of Abra. The setup and trial below target the Radeon RX 6800.
- For Linux x86-64 servers with an NVIDIA GPU, offer the optional `compose.voice.yaml` deployment. Mount verified GGUF weights read-only, publish the port on host loopback, and check model readiness. Both native and container deployments reuse the weights across restarts. [Upstream container build](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/build.md)
- Document the native equivalent for a CPU host or Apple Silicon using a server-enabled build: `nemo-speech serve --asr-model /path/to/model.gguf`. Use the same endpoint, language, and chunk settings in either deployment. A speech-service restart can interrupt dictation while Abra's chat and active work continue. [Upstream server configuration](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/server.md)
- Use a local recorder on the terminal client and browser microphone capture on the browser device. Stream 16 kHz mono PCM16 to the configured recognizer. A loopback service or operator-established tunnel is sufficient for the initial release. A terminal on an SSH host without a capture device reports that limitation.
- Limit the terminal change to an optional dictation plugin contributing to OpenCode 2.3.0's `prompt.footer` on the main Abra chat in normal input mode. The earlier chat-primary change retired the custom work footer and tests for the absence of a TUI export in the core plugin. Package dictation separately and load it only when enabled. Verify the pinned renderer's client-local paste path in a real attach before relying on it. [Prior work-visibility delta](../make-chat-the-primary-workspace/specs/work-visibility/spec.md) · [Pinned API evidence](../../../docs/supported-apis.md)
- Keep recording state and partial text in memory. Maintain one recognition session per recording and combine finalized speech segments in order. Reuse the current composer’s draft edit and submission behavior. Handle changed focus, session, and edits before insertion.
- Start with one recognition engine. Evaluate 320 ms against the 560 ms default on the same hardware if faster feedback is desired. Record actual lag, resource use, typing responsiveness and recognition of mixed Dutch/English coding prompts. Published model scores do not establish results for this build or host.

### Radeon setup and first trial

The reference Linux x86-64 host exposes a Radeon RX 6800 with approximately 16 GiB of VRAM through Mesa RADV. PipeWire reports a HyperX Cloud III Wireless microphone as the default input. These observations establish device availability. Streaming performance is still to be measured.

1. Install the prebuilt `nemo-speech-0.3.0-linux-x86_64-vulkan.tar.gz` archive and verify it against the release's SHA-256 file. Put its `nemo-speech` executable on the user PATH and retain the bundled libraries. This path uses the host Vulkan driver directly. [v0.3.0 downloads](https://github.com/NVIDIA/NeMo-Speech.cpp/releases/tag/v0.3.0)
2. Run the commands below. Confirm that the diagnostics list the Radeon, then fetch the approximately 742 MB multilingual Q8 model once. The playground opens on loopback for a standalone mic trial. The final command selects six frames of right context for a 560 ms model chunk. [Model cache](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/cli.md#models-and-cache) · [Server settings](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/config/asr.example.yaml)

   ```sh
   nemo-speech doctor
   nemo-speech pull nemotron-3.5
   nemo-speech serve --asr-model nemotron-3.5 --asr.streaming.rnnt_right_context 6 --open
   ```

3. Grant the playground microphone access on localhost. Dictate an English prompt and a Dutch prompt containing a project name or command. Check that words appear while speaking, then confirm from runtime diagnostics which device performed inference. Compare Radeon and CPU streaming on the same recorded input before recommending live settings for this host.
