# Meet Transcript Capture

A Chrome extension that captures Google Meet live captions and saves them as a timestamped transcript with speaker names.

![Extension icon](icons/icon128.png)

## Versión personal de este clon — español

Esta versión mejora el proyecto original [vincelamm/gMeetTranscriptCapture](https://github.com/vincelamm/gMeetTranscriptCapture), manteniendo su arquitectura JavaScript y Chrome Extensions Manifest V3. Se usa mediante instalación manual desde esta carpeta; no requiere compilación ni dependencias adicionales.

### Funciones

- **Interfaz en español:** iniciar y detener transcripción, espera de subtítulos, contador de intervenciones, descargas, copia de prompt y descarte.
- **Subtítulos nativos de Google Meet:** intenta activar CC al iniciar y lee el texto que Meet muestra. La extensión no accede al micrófono ni realiza reconocimiento de audio. El idioma de los subtítulos se configura en Meet.
- **Deduplicación mejorada:** compara palabras con normalización de espacios, mayúsculas, Unicode y puntuación, conservando el texto original. Actualiza las revisiones progresivas y reconstruye ventanas rolling cuando existe overlap suficiente.
- **Separación de intervenciones:** conserva speakers e identifica cada intervención internamente. Las frases distintas y los casos ambiguos se mantienen para priorizar la conservación del texto.
- **Exportación TXT y Markdown:** incluye encabezados en español y timestamps. Una limpieza final conservadora une solo revisiones adyacentes con identidad común; conserva el estado original y no limpia automáticamente las líneas antiguas sin identidad.
- **Texto pendiente:** detener y descargar durante la captura solicitan el buffer pendiente antes de guardar o exportar.
- **Prompt en español:** «Copiar prompt para IA» copia texto al portapapeles. Usarlo en otra aplicación es una acción manual del usuario.

Por ejemplo, estas ventanas de una misma intervención:

```text
Esto funciona.
Esto funciona correctamente.
```

se conservan como una intervención con el texto final:

```text
Esto funciona correctamente.
```

### Instalación manual en Chrome — Windows

1. Abre `chrome://extensions` en Chrome.
2. Activa **Modo desarrollador**.
3. Pulsa **Cargar descomprimida**.
4. Selecciona la carpeta de este clon que contiene `manifest.json`, `background.js`, `content.js`, `popup/` y `utils/`.
5. Abre una reunión en Google Meet.
6. Informa a los participantes de la transcripción. Abre el popup de **Meet Transcript Capture** y pulsa **Iniciar transcripción**.

Si Meet ya estaba abierto al cargar la extensión, recarga esa pestaña. Si los subtítulos no se activan automáticamente, actívalos con el botón **CC** de Meet. Puedes fijar el icono de la extensión desde el menú de extensiones de Chrome.

### Uso y actualización

- Durante la captura, el popup muestra el estado y el número de intervenciones capturadas.
- Al terminar, pulsa **Detener transcripción** y después **Descargar .txt** o **Descargar .md**. También puedes descargar durante la captura.
- **Descartar** borra la transcripción almacenada en la extensión; los archivos ya descargados permanecen en tu equipo.
- Descarga lo que quieras conservar **antes de cerrar Chrome o recargar/actualizar la extensión**.
- Después de un cambio local, abre `chrome://extensions` y pulsa el botón de recarga de esta extensión. Luego recarga las pestañas de Meet abiertas. No hace falta volver a cargar la carpeta descomprimida.
- Las actualizaciones de código se aplican a esta misma carpeta. Esta versión no hace pull, commit ni push automáticamente. El aviso existente de actualizaciones consulta releases del proyecto original; no actualiza este clon.

### Privacidad y almacenamiento

La extensión procesa el texto capturado dentro del navegador y guarda la transcripción en `chrome.storage.session`, un almacenamiento temporal de la sesión. No transmite las transcripciones a un servicio externo y no añade APIs pagadas, OpenAI, Whisper ni Google Cloud.

La conexión de red propia de la extensión es la consulta existente a GitHub para comprobar versiones. Su caché se guarda en `chrome.storage.local`; no incluye el contenido de la reunión. Los subtítulos siguen siendo los que proporciona Google Meet.

Informa a los participantes antes de iniciar y trata los archivos exportados como contenido privado. Si pegas el prompt o la transcripción en otro servicio, ese envío ocurre por tu acción manual.

### Tests

Desde PowerShell, situado en la carpeta que contiene `manifest.json`, ejecuta:

```powershell
node --test tests/*.test.js
```

Se utiliza el runner integrado de Node.js, sin Jest, Vitest ni instalación de paquetes. La suite se ha ejecutado con Node.js **22.18.0**. Las pruebas cubren puntuación final, mayúsculas, Unicode, captions progresivos y rolling, speakers simultáneos, pausas, frases cortas repetidas, identidad de intervenciones, limpieza final, exportaciones y vaciado de buffers.

El caso real de revisiones a los segundos **13, 14, 15 y 20** se comprueba tanto en captura como en exportación TXT/Markdown. Los anteriores casos `KNOWN GAP` de puntuación y frases cortas tienen pruebas de regresión en [tests/caption-dedup.test.js](tests/caption-dedup.test.js).

Las pruebas de integración cargan el código real mediante `node:vm`, con reloj, DOM y APIs de Chrome simulados. **No constituyen una prueba E2E en Chrome o Google Meet real.**

### Limitaciones conocidas

- La calidad del texto depende de los subtítulos de Meet. Un cambio en su DOM puede requerir ajustes en los selectores o estrategias de detección.
- Los límites de intervención se infieren a partir de cambios del DOM, desaparición del speaker y una ventana de inactividad de 12 segundos; no se mide silencio de audio. Sin una señal de límite, una repetición idéntica puede ser indistinguible de un subtítulo que permanece visible.
- Un desmontaje y reconstrucción del DOM puede separar una misma intervención. Se prefieren duplicados conservadores antes que descartar contenido ambiguo.
- Sigue pendiente una cola de mensajes para interrupciones de la conexión con el service worker. Las líneas confirmadas durante una desconexión pueden perderse; el vaciado al detener o descargar no resuelve toda la reconexión. Véase [TICKET-002](tickets/TICKET-002-caption-verlust-bei-port-reconnect.md).
- La captura se suprime temporalmente mientras la extensión opera ciertos controles de Meet para evitar anuncios de la interfaz; palabras pronunciadas en ese intervalo podrían no capturarse.
- No se garantiza recuperación del buffer si la pestaña se cierra o deja de responder antes de vaciarlo. El almacenamiento de sesión no es una copia de seguridad persistente.
- La validación manual en Chrome/Meet real sigue pendiente. Los nombres de speaker provienen de Meet; el modo de captura solo de texto puede carecer de nombres.

## Features

- **Attempts to enable captions** (CC) when you start capture; manual instructions appear if detection fails
- Captures live captions from Google Meet in real time with speaker names
- Handles Google Meet's rolling/revised captions with conservative deduplication; ambiguous cases may retain duplicates
- **Attempts to capture meeting metadata automatically** — opens the Meeting details panel on capture start to read available scheduled time, organizer, participants, description, join URL and dial-in number
- **Attempts to detect the transcript author** — reads your own name when available in the Meet UI
- Download the transcript as **plain text** (`.txt`) or **Markdown** (`.md`)
- **Copy an AI prompt** — wraps the transcript in a structured Spanish meeting-minutes prompt, ready to paste manually into an AI tool
- Transcript is stored for the browser session, so you can download after the meeting ends
- Includes localized caption-region detection; compatibility depends on Meet's current UI (see the limitations above)

**Example output:**

```
Reunión: Reunión semanal
Inicio: 2026-07-18 09:00:00
Duración: 00:00:34
Organizador: Ana
Transcripción realizada por: Manuel
Participantes: Ana, Manuel, Luis
──────────────────────────────────────────────────
[00:00:12] Ana
Tenemos que revisar la base de producción mañana.

[00:00:34] Manuel
De acuerdo, lo revisamos a primera hora.
──────────────────────────────────────────────────
Fin de la transcripción
```

## Installation

This extension is not on the Chrome Web Store. Install it directly from the source:

For this personal version, use the existing clone and the Windows installation steps above. The download instructions below refer to the original project.

### 1. Download the extension

Clone the repository or download the ZIP:

```bash
git clone https://github.com/vincelamm/gMeetTranscriptCapture.git
```

Or click **Code → Download ZIP** on GitHub and unzip it.

### 2. Open Chrome Extensions

Go to `chrome://extensions` in your browser.

### 3. Enable Developer mode

Toggle **Developer mode** on in the top-right corner.

### 4. Load the extension

Click **Load unpacked** and select the folder you cloned or unzipped.

The extension icon will appear in your Chrome toolbar. Pin it for easy access by clicking the puzzle piece icon and pinning **Meet Transcript Capture**.

## Privacy & consent — please read before use

> **You are responsible for informing all meeting participants that the conversation is being transcribed.**

Recording or transcribing a conversation without the knowledge of the other participants may be **illegal** in your jurisdiction. Many countries and US states require the consent of all parties to a conversation before it may be recorded (e.g. California's two-party consent law, the EU's GDPR, Germany's §201 StGB). Even where it is not legally required, transcribing without disclosure is generally considered poor practice and a breach of trust.

**Before you start capturing, you must:**

1. Announce at the start of the meeting — verbally or in the chat — that you are creating a transcript, for example:
   > *"Just a heads-up: I'm using a transcript tool to capture the notes from this call. Let me know if anyone objects."*
2. Give participants a reasonable opportunity to object or leave before you click **Iniciar transcripción**.
3. Handle the resulting transcript with care — treat it as you would any other record of a private conversation.

This tool reads Google Meet's own live captions and does not access your microphone or audio stream directly. That does not change your obligations toward other participants.

---

## Usage

1. Join a Google Meet call
2. **Inform all participants** that you will be capturing a transcript (see above)
3. Click the **Meet Transcript Capture** icon in your toolbar
4. Click **Iniciar transcripción** — the extension attempts to enable captions and opens the Meeting details panel
5. Talk — the extension reads the available captions and speaker labels
6. When done, click **Detener transcripción**
7. Click **Descargar .txt** or **Descargar .md** to save the transcript, or click **Copiar prompt para IA** to copy a ready-to-use prompt for generating meeting minutes

> **Meeting metadata:** the extension attempts to open the Meeting details panel when capture starts to read the scheduled time, organizer, participants and description. Extraction depends on the available UI and may be incomplete.

> If auto-enable doesn't work (e.g. after a Meet UI update), the extension will show instructions to enable captions manually via the CC button or by pressing `c`.

> The transcript is kept in memory for the browser session. If you close the browser before downloading, the transcript is lost.

## Updating

After pulling new changes from the repository, go to `chrome://extensions` and click the **reload icon** on the extension card. Then refresh any open Meet tabs.

## Notes on accuracy

- The extension reads Meet's CC widget, not the audio — captions are auto-enabled on capture start, but if that fails you'll need to enable them manually
- Google Meet's speech recognition may revise words after they're spoken; the extension updates compatible revisions in place and keeps ambiguous cases separate
- Speaker names come directly from Meet's caption display and match what Meet shows on screen
- The extension uses `jsname`, position and text-only strategies to find captions in Meet's DOM. If Google updates their frontend and captions stop being captured, see [`CLAUDE.md`](CLAUDE.md) for developer context; some historical notes there predate this version

## Permissions

| Permission | Why |
|---|---|
| `meet.google.com` | Read the captions from the Meet tab |
| `api.github.com` | Check upstream releases for the update notice; no transcript upload |
| `storage` | Keep the transcript in `storage.session` and the update-check cache in `storage.local` |
| `downloads` | Save the transcript file to your Downloads folder |

## License

[MIT](LICENSE)
