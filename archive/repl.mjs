import { createInterface } from "readline";
import chalk from "chalk";
import ora from "ora";

const PROMPT = chalk.cyan("engie") + chalk.gray(" > ");

export class Repl {
  constructor(gateway, { sessionKey = "agent:engie:cli" } = {}) {
    this.gw = gateway;
    this.sessionKey = sessionKey;
    this.rl = null;
    this.busy = false;
    this.currentText = "";
    this.spinner = null;
  }

  start() {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: PROMPT,
      terminal: true,
    });

    console.log(chalk.bold("\n  Engie") + chalk.gray(" — your AI project manager"));
    console.log(chalk.gray("  Type a message or /quit to exit.\n"));
    this.rl.prompt();

    this.rl.on("line", (line) => this._onLine(line.trim()));
    this.rl.on("close", () => this.stop());

    // Wire up gateway streaming — filter to our session only
    this.gw.on("agent", (payload) => {
      if (payload.sessionKey === this.sessionKey) this._onAgent(payload);
    });
    this.gw.on("chat", (payload) => {
      if (payload.sessionKey === this.sessionKey) this._onChat(payload);
    });
    this.gw.on("disconnected", () => {
      if (this.spinner) this.spinner.fail("Disconnected from gateway");
      this.spinner = null;
      this.busy = false;
      console.log(chalk.red("\nLost connection to Engie gateway."));
      process.exit(1);
    });
  }

  async _onLine(input) {
    if (!input) { this.rl.prompt(); return; }

    // Commands
    if (input === "/quit" || input === "/exit" || input === "/q") {
      this.stop();
      return;
    }
    if (input === "/clear") {
      console.clear();
      this.rl.prompt();
      return;
    }
    if (input === "/session") {
      console.log(chalk.gray(`  Session: ${this.sessionKey}`));
      this.rl.prompt();
      return;
    }

    if (this.busy) {
      console.log(chalk.yellow("  Still thinking... please wait."));
      return;
    }

    this.busy = true;
    this.currentText = "";
    this.spinner = ora({ text: "Thinking...", color: "cyan" }).start();

    try {
      await this.gw.chat(this.sessionKey, input);
      // Response arrives via agent/chat events
    } catch (err) {
      if (this.spinner) this.spinner.fail("Error");
      console.log(chalk.red(`  ${err.message}`));
      this.busy = false;
      this.rl.prompt();
    }
  }

  _onAgent(payload) {
    const data = payload.data || {};
    const stream = payload.stream;

    // lifecycle events
    if (stream === "lifecycle") {
      if (data.phase === "error") {
        if (this.spinner) this.spinner.fail("Error");
        console.log(chalk.red(`  ${data.message || "Agent error"}`));
      }
      return;
    }

    // assistant text stream
    if (stream === "assistant") {
      // delta = incremental new text, text = accumulated full text
      const fullText = data.text || data.content || "";
      const delta = data.delta || "";
      if (!fullText && !delta) return;

      // First token — clear spinner and start printing
      if (this.spinner) {
        this.spinner.stop();
        this.spinner = null;
        process.stdout.write("\n");
      }

      // Use delta if available (new text only), otherwise diff against accumulated
      if (delta && fullText) {
        const newContent = fullText.slice(this.currentText.length);
        if (newContent) process.stdout.write(chalk.white(newContent));
        this.currentText = fullText;
      } else if (delta) {
        process.stdout.write(chalk.white(delta));
        this.currentText += delta;
      } else {
        const newContent = fullText.slice(this.currentText.length);
        if (newContent) process.stdout.write(chalk.white(newContent));
        this.currentText = fullText;
      }
    }
  }

  _onChat(payload) {
    const state = payload?.state;

    if (state === "final") {
      if (this.spinner) {
        this.spinner.stop();
        this.spinner = null;
      }

      // If no streaming text was received, extract from final message
      if (!this.currentText && payload?.message?.content) {
        const content = payload.message.content;
        let text = "";
        if (typeof content === "string") {
          text = content;
        } else if (Array.isArray(content)) {
          text = content.filter(b => b.type === "text").map(b => b.text).join("\n");
        }
        if (text) {
          process.stdout.write("\n" + chalk.white(text));
        }
      }

      // Ensure we end with a newline after streamed text
      if (this.currentText || payload?.message?.content) {
        process.stdout.write("\n");
      }
      console.log();
      this.busy = false;
      this.currentText = "";
      this.rl.prompt();
    }

    if (state === "error") {
      if (this.spinner) this.spinner.fail("Error");
      this.spinner = null;
      const errMsg = payload?.errorMessage || "Unknown error";
      console.log(chalk.red(`\n  ${errMsg}`));
      console.log();
      this.busy = false;
      this.currentText = "";
      this.rl.prompt();
    }
  }

  stop() {
    if (this.spinner) this.spinner.stop();
    if (this.rl) this.rl.close();
    this.gw.disconnect();
    console.log(chalk.gray("\nGoodbye.\n"));
    process.exit(0);
  }
}
