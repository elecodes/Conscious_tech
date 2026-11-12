import type { Browser } from "playwright";

/** Simulated browser service events verify integration, not microphone transcription. */
export async function verifyVoiceDictation(browser: Browser, url: string, output?: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(`
    window.__voice = { instances: [], failStart: false,
      emit(parts, index = 0) {
        const instance = this.instances.at(-1);
        instance.onresult?.({resultIndex:index, results:parts.map(([transcript,isFinal]) => ({0:{transcript,confidence:1},length:1,isFinal}))});
      },
      started() {this.instances.at(-1).onstart?.();},
      ended() {this.instances.at(-1).onend?.();},
      error(error) {const instance=this.instances.at(-1);const ended=instance.onend;instance.onerror?.({error});ended?.();}
    };
    class Recognition extends EventTarget {
      continuous=false; interimResults=false; lang='';
      onstart=null; onresult=null; onerror=null; onend=null;
      starts=0; stops=0; aborts=0;
      constructor() {super();window.__voice.instances.push(this);}
      start() {this.starts++;if(window.__voice.failStart) throw new Error('start failed');}
      stop() {this.stops++;}
      abort() {this.aborts++;}
    }
    window.SpeechRecognition=Recognition;
    window.webkitSpeechRecognition=Recognition;
  `);
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    const input = page.getByTestId("flow-textarea");
    const button = page.getByTestId("voice-dictation-btn");
    const status = page.getByTestId("voice-status");
    const error = page.getByTestId("voice-error");
    await input.fill("Notas previas.");
    await button.click();
    if (!(await button.innerText()).includes("Conectando")) throw new Error("No starting feedback");
    await button.click();
    await page.evaluate("window.__voice.ended()");
    await page.waitForFunction(
      "document.querySelector('[data-testid=voice-dictation-btn]').getAttribute('aria-pressed') === 'false'"
    );
    await button.click();
    await page.evaluate("window.__voice.started()");
    await page.evaluate("window.__voice.emit([['Comprar', false]])");
    await page.waitForFunction(
      "document.querySelector('[data-testid=flow-textarea]').value === 'Notas previas. Comprar'"
    );
    await page.evaluate("window.__voice.emit([['Comprar pan', false]])");
    await page.waitForFunction(
      "document.querySelector('[data-testid=flow-textarea]').value === 'Notas previas. Comprar pan'"
    );
    await page.evaluate("window.__voice.emit([['Comprar pan.', true]])");
    await page.waitForFunction(
      "document.querySelector('[data-testid=flow-textarea]').value === 'Notas previas. Comprar pan.'"
    );
    await page.evaluate("window.__voice.emit([['Comprar pan.', true],['Estudiar', false]], 1)");
    await page.waitForFunction(
      "document.querySelector('[data-testid=flow-textarea]').value === 'Notas previas. Comprar pan. Estudiar'"
    );
    await page.evaluate(
      "window.__voice.emit([['Comprar pan.', true],['Estudiar Python.', true]], 1)"
    );
    await page.waitForFunction(
      "document.querySelector('[data-testid=flow-textarea]').value === 'Notas previas. Comprar pan. Estudiar Python.'"
    );
    await page.evaluate(
      "window.__voice.emit([['Comprar pan.', true],['Estudiar Python.', true]], 0)"
    );
    if ((await input.inputValue()) !== "Notas previas. Comprar pan. Estudiar Python.")
      throw new Error("Repeated final event duplicates notes");
    await button.click();
    // A final result can arrive after stop; preserve it.
    await page.evaluate(
      "window.__voice.emit([['Comprar pan.', true],['Estudiar Python mañana.', true]], 1);window.__voice.ended()"
    );
    await page.waitForFunction(
      "document.querySelector('[data-testid=flow-textarea]').value.endsWith('Python mañana.')"
    );
    await status.waitFor();
    await button.click();
    await page.evaluate("window.__voice.started()");
    await page.evaluate("window.__voice.emit([['Llamar al médico.', true]])");
    await page.waitForFunction(
      "document.querySelector('[data-testid=flow-textarea]').value.endsWith('Llamar al médico.')"
    );
    await input.fill("Corrección manual que debe conservarse");
    await page.evaluate("window.__voice.emit([['No sobrescribir.', true]])");
    if ((await input.inputValue()) !== "Corrección manual que debe conservarse")
      throw new Error("Dictation overwrote manual edits");
    for (const [code, message] of [
      ["not-allowed", "micrófono está bloqueado"],
      ["network", "conectar"],
      ["audio-capture", "acceder al micrófono"],
      ["no-speech", "detectado voz"],
    ]) {
      await button.click();
      await page.evaluate("window.__voice.started()");
      await page.evaluate((code) => {
        (window as unknown as { __voice: { error: (code: string) => void } }).__voice.error(code);
      }, code);
      await error.waitFor();
      if (!(await error.innerText()).includes(message!))
        throw new Error(`Missing actionable error: ${code}`);
      if (await page.evaluate("window.__voice.instances.at(-1).starts !== 1"))
        throw new Error("Voice service restarts after failure");
      if ((await input.inputValue()) !== "Corrección manual que debe conservarse")
        throw new Error("Error discarded notes");
    }
    await page.getByTestId("voice-options-popover").locator("summary").click();
    await page.getByTestId("voice-lang-select").selectOption("en-US");
    await button.click();
    if (await page.evaluate("window.__voice.instances.at(-1).lang !== 'en-US'"))
      throw new Error("Language selection ignored");
    if (!(await page.getByTestId("voice-lang-select").isDisabled()))
      throw new Error("Language can change during start");
    await page.evaluate("window.__voice.started();window.__voice.ended()");
    if (await page.evaluate("window.__voice.instances.at(-1).starts !== 1"))
      throw new Error("Unexpected restart on silence/end");
    await page.evaluate("window.__voice.failStart = true");
    await button.click();
    await error.waitFor();
    if (!(await error.innerText()).includes("iniciar")) throw new Error("Start exception hidden");
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Voice feedback overflows mobile");
    if (output) await page.screenshot({ path: `${output}/voice-feedback-mobile.png` });
    await page.evaluate("window.__voice.failStart = false");
    await button.click();
    await page.evaluate("window.__voice.started()");
    await page.getByTestId("nav-tab-active").click();
    if (
      await page.evaluate(
        "window.__voice.instances.at(-1).onresult !== null || window.__voice.instances.at(-1).aborts === 0"
      )
    )
      throw new Error("Leaving capture does not release the voice session");
    console.log(
      "  ✓ Voice service simulation: start/stop, interim/final text, repeat events, manual edits, errors, language and mobile verified (not real audio)"
    );
  } finally {
    await context.close();
  }
}
