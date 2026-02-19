// Main setup wizard Ink component.
// Manages step state, renders steps sequentially, handles user input.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp } from "ink";
import { TextInput, ConfirmInput } from "@inkjs/ui";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";

import { colors } from "./lib/theme.js";
import { WelcomeScreen } from "./components/WelcomeScreen.js";
import { StepList } from "./components/StepList.js";
import {
  engieHome,
  ensureDirs,
  ensureOpenclawSymlink,
  openclawConfigPath,
  envFilePath,
  mcpToolsPath,
  initStatePath,
} from "../lib/paths.js";
import {
  runAllChecks,
  checkOpenClaw,
  checkOllama,
  checkClaude,
} from "../lib/prereqs.js";
import {
  getServiceDefs,
  installService,
  startAllServices,
  checkServiceHealth,
} from "../lib/services.js";
import {
  generateOpenclawConfig,
  generateEnvFile,
  generateMcpToolsConfig,
  generateGatewayToken,
} from "../lib/config-gen.js";
import { writeProfile } from "../lib/profile.js";

const e = React.createElement;

// ── Step definitions ────────────────────────────────────────────────────────

const STEP_DEFS = [
  { id: "system_check", label: "System check" },
  { id: "openclaw", label: "OpenClaw" },
  { id: "ollama", label: "Ollama" },
  { id: "claude", label: "Claude Code" },
  { id: "config", label: "Configuration" },
  { id: "directories", label: "Directories" },
  { id: "mcp_bridge", label: "MCP Bridge" },
  { id: "services", label: "Services" },
  { id: "health", label: "Health check" },
  { id: "profile", label: "Profile" },
];

// ── Init state persistence ──────────────────────────────────────────────────

function readInitState() {
  try {
    const p = initStatePath();
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, "utf-8"));
    }
  } catch { /* ignore */ }
  return { completedSteps: [], timestamp: null };
}

function writeInitState(state) {
  try {
    writeFileSync(initStatePath(), JSON.stringify(state, null, 2) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

function markStepComplete(stepId) {
  const state = readInitState();
  if (!state.completedSteps.includes(stepId)) {
    state.completedSteps.push(stepId);
  }
  state.timestamp = new Date().toISOString();
  writeInitState(state);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function tryExec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout: opts.timeout || 30000,
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

function whichSync(name) {
  return tryExec(`which ${name}`);
}

// ── Prompt sub-components ───────────────────────────────────────────────────

function ConfirmPrompt({ question, onResult, defaultYes }) {
  return e(Box, { marginLeft: 2, marginTop: 1 },
    e(Text, { color: colors.cyan }, `? ${question} `),
    e(ConfirmInput, {
      defaultChoice: defaultYes !== false ? "confirm" : "deny",
      onConfirm: () => onResult(true),
      onCancel: () => onResult(false),
    })
  );
}

function TextPrompt({ question, onSubmit, placeholder, optional }) {
  return e(Box, { marginLeft: 2, marginTop: 1 },
    e(Text, { color: colors.cyan }, `? ${question}`),
    optional ? e(Text, { color: colors.grayDim }, " (optional)") : null,
    e(Text, { color: colors.cyan }, ": "),
    e(TextInput, {
      placeholder: placeholder || "",
      onSubmit: (val) => onSubmit(val || ""),
    })
  );
}

// ── Main Wizard ─────────────────────────────────────────────────────────────

export function WizardApp() {
  const app = useApp();

  // Step tracking
  const [steps, setSteps] = useState(() => {
    const saved = readInitState();
    const isResuming = saved.completedSteps.length > 0;
    return STEP_DEFS.map((def) => ({
      ...def,
      status: saved.completedSteps.includes(def.id) ? "done" : "pending",
      detail: saved.completedSteps.includes(def.id) ? "previously completed" : "",
    }));
  });

  const [resuming] = useState(() => readInitState().completedSteps.length > 0);
  const [currentStepIdx, setCurrentStepIdx] = useState(() => {
    const saved = readInitState();
    const firstIncomplete = STEP_DEFS.findIndex(
      (s) => !saved.completedSteps.includes(s.id)
    );
    return firstIncomplete === -1 ? STEP_DEFS.length : firstIncomplete;
  });

  // Phase within a step (for multi-phase steps like config)
  const [phase, setPhase] = useState("init");
  const [finished, setFinished] = useState(false);

  // Collected data across steps
  const dataRef = useRef({
    gatewayToken: generateGatewayToken(),
    anthropicKey: "",
    slackToken: "",
    telegramToken: "",
    claudeFound: false,
    ollamaFound: false,
    openclawFound: false,
    profileName: "",
    profileRole: "",
    profileOrg: "",
  });

  // ── Step update helper ──────────────────────────────────────────────────

  const updateStep = useCallback((id, patch) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  }, []);

  const completeStep = useCallback((id, detail) => {
    updateStep(id, { status: "done", detail: detail || "" });
    markStepComplete(id);
  }, [updateStep]);

  const failStep = useCallback((id, detail) => {
    updateStep(id, { status: "failed", detail: detail || "failed" });
  }, [updateStep]);

  const skipStep = useCallback((id, detail) => {
    updateStep(id, { status: "skipped", detail: detail || "skipped" });
    markStepComplete(id);
  }, [updateStep]);

  const activateStep = useCallback((id) => {
    updateStep(id, { status: "active", detail: "" });
  }, [updateStep]);

  const advanceToNext = useCallback(() => {
    setCurrentStepIdx((prev) => prev + 1);
    setPhase("init");
  }, []);

  // ── Step execution logic ──────────────────────────────────────────────

  // Each step runs when currentStepIdx changes.
  // Some steps need user input, so they set phase states and wait.

  useEffect(() => {
    if (currentStepIdx >= STEP_DEFS.length) {
      // All done
      setFinished(true);
      return;
    }

    const stepDef = STEP_DEFS[currentStepIdx];

    // Skip already-completed steps (from resume)
    if (readInitState().completedSteps.includes(stepDef.id)) {
      advanceToNext();
      return;
    }

    // Activate the current step
    activateStep(stepDef.id);

    // Auto-run steps that need no input
    if (stepDef.id === "system_check" && phase === "init") {
      runSystemCheck();
    } else if (stepDef.id === "openclaw" && phase === "init") {
      runOpenclawCheck();
    } else if (stepDef.id === "ollama" && phase === "init") {
      runOllamaCheck();
    } else if (stepDef.id === "claude" && phase === "init") {
      runClaudeCheck();
    } else if (stepDef.id === "directories" && phase === "init") {
      runDirectories();
    } else if (stepDef.id === "services" && phase === "init") {
      runServices();
    } else if (stepDef.id === "health" && phase === "init") {
      runHealthCheck();
    }
    // config, mcp_bridge, profile phases are driven by user input / phase changes
  }, [currentStepIdx, phase]);

  // ── Step implementations ──────────────────────────────────────────────

  function runSystemCheck() {
    setTimeout(() => {
      const checks = runAllChecks();
      if (!checks.platform.supported) {
        failStep("system_check", `Unsupported platform: ${checks.platform.platform}`);
        return;
      }

      const parts = [];
      if (checks.platform.supported) parts.push(`macOS ${checks.platform.version}`);
      if (checks.bun.installed) parts.push(`Bun ${checks.bun.version}`);
      if (checks.brew.installed) parts.push(`Brew ${checks.brew.version}`);

      const missing = [];
      if (!checks.bun.installed) missing.push("Bun");
      if (!checks.brew.installed) missing.push("Homebrew");

      if (missing.length > 0) {
        failStep("system_check", `Missing: ${missing.join(", ")}`);
        return;
      }

      completeStep("system_check", parts.join(", "));
      advanceToNext();
    }, 300);
  }

  function runOpenclawCheck() {
    setTimeout(() => {
      const result = checkOpenClaw();
      dataRef.current.openclawFound = result.installed;
      if (result.installed) {
        completeStep("openclaw", `v${result.version}`);
        advanceToNext();
      } else {
        // Need user input
        setPhase("ask_install");
      }
    }, 200);
  }

  function handleOpenclawInstall(yes) {
    if (yes) {
      updateStep("openclaw", { status: "active", detail: "installing..." });
      setTimeout(() => {
        const result = tryExec("bun install -g openclaw", { timeout: 60000 });
        if (result !== null) {
          const check = checkOpenClaw();
          if (check.installed) {
            dataRef.current.openclawFound = true;
            completeStep("openclaw", `installed v${check.version}`);
          } else {
            failStep("openclaw", "install succeeded but binary not found");
          }
        } else {
          failStep("openclaw", "install failed");
        }
        advanceToNext();
      }, 100);
    } else {
      skipStep("openclaw", "manual install needed");
      advanceToNext();
    }
  }

  function runOllamaCheck() {
    setTimeout(() => {
      const result = checkOllama();
      dataRef.current.ollamaFound = result.installed;
      if (result.installed) {
        completeStep("ollama", `v${result.version}`);
        advanceToNext();
      } else {
        setPhase("ask_install");
      }
    }, 200);
  }

  function handleOllamaInstall(yes) {
    if (yes) {
      updateStep("ollama", { status: "active", detail: "installing via brew..." });
      setTimeout(() => {
        const brewResult = tryExec("brew install ollama", { timeout: 120000 });
        if (brewResult !== null) {
          updateStep("ollama", { status: "active", detail: "pulling llama3.2..." });
          setTimeout(() => {
            // Start ollama serve in background first, then pull
            tryExec("brew services start ollama", { timeout: 15000 });
            // Give it a moment to start
            setTimeout(() => {
              const pullResult = tryExec("ollama pull llama3.2", { timeout: 300000 });
              if (pullResult !== null) {
                dataRef.current.ollamaFound = true;
                completeStep("ollama", "installed + llama3.2 pulled");
              } else {
                dataRef.current.ollamaFound = true;
                completeStep("ollama", "installed (pull llama3.2 manually)");
              }
              advanceToNext();
            }, 3000);
          }, 100);
        } else {
          failStep("ollama", "brew install failed");
          advanceToNext();
        }
      }, 100);
    } else {
      skipStep("ollama", "optional, skipped");
      advanceToNext();
    }
  }

  function runClaudeCheck() {
    setTimeout(() => {
      const result = checkClaude();
      dataRef.current.claudeFound = result.installed;
      if (result.installed) {
        completeStep("claude", `v${result.version}`);
      } else {
        skipStep("claude", "not found (optional)");
      }
      advanceToNext();
    }, 200);
  }

  // Config step is multi-phase: ask for API key, then optional tokens
  function handleAnthropicKey(val) {
    const key = val.trim();
    if (!key) {
      // Re-prompt
      updateStep("config", { status: "active", detail: "API key is required" });
      setPhase("ask_anthropic_key");
      return;
    }
    dataRef.current.anthropicKey = key;
    setPhase("ask_slack_token");
  }

  function handleSlackToken(val) {
    dataRef.current.slackToken = val.trim();
    setPhase("ask_telegram_token");
  }

  function handleTelegramToken(val) {
    dataRef.current.telegramToken = val.trim();
    setPhase("write_config");
  }

  // Write config files when all tokens collected
  useEffect(() => {
    if (phase !== "write_config") return;
    if (STEP_DEFS[currentStepIdx]?.id !== "config") return;

    updateStep("config", { status: "active", detail: "writing config files..." });

    setTimeout(() => {
      try {
        // Ensure config dir exists first
        ensureDirs();

        const token = dataRef.current.gatewayToken;

        // openclaw.json
        const ocConfig = generateOpenclawConfig({ token });
        writeFileSync(openclawConfigPath(), JSON.stringify(ocConfig, null, 2) + "\n", "utf-8");

        // .env
        const envContent = generateEnvFile({
          anthropicKey: dataRef.current.anthropicKey,
          gatewayToken: token,
          slackToken: dataRef.current.slackToken,
          telegramToken: dataRef.current.telegramToken,
        });
        writeFileSync(envFilePath(), envContent, "utf-8");

        // mcp-tools.json
        const mcpConfig = generateMcpToolsConfig();
        writeFileSync(mcpToolsPath(), JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");

        completeStep("config", "3 files written");
        advanceToNext();
      } catch (err) {
        failStep("config", err.message);
        advanceToNext();
      }
    }, 200);
  }, [phase, currentStepIdx]);

  function runDirectories() {
    setTimeout(() => {
      try {
        ensureDirs();
        ensureOpenclawSymlink();
        completeStep("directories", "all directories created, symlink set");
        advanceToNext();
      } catch (err) {
        failStep("directories", err.message);
        advanceToNext();
      }
    }, 200);
  }

  // MCP bridge step
  useEffect(() => {
    if (STEP_DEFS[currentStepIdx]?.id !== "mcp_bridge") return;
    if (phase !== "init") return;

    if (!dataRef.current.claudeFound) {
      skipStep("mcp_bridge", "claude CLI not found");
      advanceToNext();
      return;
    }

    updateStep("mcp_bridge", { status: "active", detail: "registering with claude..." });

    setTimeout(() => {
      try {
        const bridgePath = resolve(engieHome(), "mcp-bridge", "index.mjs");
        const bunPath = whichSync("bun") || "bun";

        // Remove existing registration first (ignore errors)
        tryExec(`claude mcp remove engie`, { timeout: 10000 });

        const result = tryExec(
          `claude mcp add engie "${bunPath}" "${bridgePath}"`,
          { timeout: 15000 }
        );

        if (result !== null) {
          completeStep("mcp_bridge", "registered as claude MCP server");
        } else {
          // Try without checking result - some versions don't output anything
          completeStep("mcp_bridge", "registration attempted");
        }
      } catch (err) {
        failStep("mcp_bridge", err.message);
      }
      advanceToNext();
    }, 300);
  }, [currentStepIdx, phase]);

  function runServices() {
    updateStep("services", { status: "active", detail: "installing plists..." });

    setTimeout(() => {
      try {
        const defs = getServiceDefs();
        const managed = defs.filter((d) => d.managed);
        const errors = [];

        for (const def of managed) {
          try {
            installService(def);
          } catch (err) {
            errors.push(`${def.displayName}: ${err.message}`);
          }
        }

        if (errors.length > 0) {
          failStep("services", errors.join("; "));
        } else {
          // Also start them
          updateStep("services", { status: "active", detail: "starting services..." });
          setTimeout(() => {
            try {
              const results = startAllServices();
              const failed = results.filter((r) => !r.ok);
              if (failed.length > 0) {
                completeStep("services",
                  `installed, ${failed.length} failed to start`);
              } else {
                completeStep("services", `${results.length} services started`);
              }
            } catch (err) {
              completeStep("services", "installed but start had issues");
            }
            advanceToNext();
          }, 500);
        }
      } catch (err) {
        failStep("services", err.message);
        advanceToNext();
      }
    }, 300);
  }

  function runHealthCheck() {
    updateStep("health", { status: "active", detail: "waiting for services..." });

    let attempts = 0;
    const maxAttempts = 15;
    const healthResults = {};

    const poll = () => {
      attempts++;
      const defs = getServiceDefs();

      Promise.all(
        defs.map(async (def) => {
          const h = await checkServiceHealth(def.healthUrl);
          healthResults[def.displayName] = h.healthy;
          return { name: def.displayName, healthy: h.healthy };
        })
      ).then((results) => {
        const healthy = results.filter((r) => r.healthy);
        const total = results.length;

        updateStep("health", {
          status: "active",
          detail: `${healthy.length}/${total} healthy (attempt ${attempts}/${maxAttempts})`,
        });

        if (healthy.length === total || attempts >= maxAttempts) {
          if (healthy.length === total) {
            completeStep("health", `all ${total} services healthy`);
          } else {
            const unhealthy = results
              .filter((r) => !r.healthy)
              .map((r) => r.name);
            completeStep("health",
              `${healthy.length}/${total} healthy (${unhealthy.join(", ")} down)`);
          }
          advanceToNext();
        } else {
          setTimeout(poll, 1000);
        }
      }).catch(() => {
        if (attempts >= maxAttempts) {
          completeStep("health", "could not verify (services may still be starting)");
          advanceToNext();
        } else {
          setTimeout(poll, 1000);
        }
      });
    };

    setTimeout(poll, 1000);
  }

  // Profile step callbacks
  function handleProfileAsk(yes) {
    if (yes) {
      setPhase("ask_name");
    } else {
      skipStep("profile", "skipped");
      advanceToNext();
    }
  }

  function handleProfileName(val) {
    dataRef.current.profileName = val.trim();
    setPhase("ask_role");
  }

  function handleProfileRole(val) {
    dataRef.current.profileRole = val.trim();
    setPhase("ask_org");
  }

  function handleProfileOrg(val) {
    dataRef.current.profileOrg = val.trim();
    setPhase("write_profile");
  }

  useEffect(() => {
    if (phase !== "write_profile") return;
    if (STEP_DEFS[currentStepIdx]?.id !== "profile") return;

    try {
      const profileData = {};
      if (dataRef.current.profileName) profileData.name = dataRef.current.profileName;
      if (dataRef.current.profileRole) profileData.role = dataRef.current.profileRole;
      if (dataRef.current.profileOrg) profileData.org = dataRef.current.profileOrg;

      if (Object.keys(profileData).length > 0) {
        writeProfile("user", profileData);
        completeStep("profile", `saved for ${profileData.name || "user"}`);
      } else {
        skipStep("profile", "no info provided");
      }
    } catch (err) {
      failStep("profile", err.message);
    }
    advanceToNext();
  }, [phase, currentStepIdx]);

  // ── Finish ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(() => {
      app.exit();
    }, 500);
    return () => clearTimeout(timer);
  }, [finished, app]);

  // ── Render ────────────────────────────────────────────────────────────

  const currentStep = STEP_DEFS[currentStepIdx];

  // Determine what prompt to show
  let prompt = null;

  if (currentStep) {
    // OpenClaw install prompt
    if (currentStep.id === "openclaw" && phase === "ask_install") {
      prompt = e(ConfirmPrompt, {
        question: "Install OpenClaw via bun?",
        defaultYes: true,
        onResult: handleOpenclawInstall,
      });
    }

    // Ollama install prompt
    if (currentStep.id === "ollama" && phase === "ask_install") {
      prompt = e(Box, { flexDirection: "column" },
        e(Box, { marginLeft: 2 },
          e(Text, { color: colors.grayDim }, "(Ollama is optional - provides local LLM for simple tasks)")
        ),
        e(ConfirmPrompt, {
          question: "Install Ollama + llama3.2?",
          defaultYes: false,
          onResult: handleOllamaInstall,
        })
      );
    }

    // Config prompts
    if (currentStep.id === "config" && (phase === "init" || phase === "ask_anthropic_key")) {
      prompt = e(TextPrompt, {
        question: "ANTHROPIC_API_KEY",
        placeholder: "sk-ant-...",
        onSubmit: handleAnthropicKey,
      });
    }

    if (currentStep.id === "config" && phase === "ask_slack_token") {
      prompt = e(TextPrompt, {
        question: "SLACK_BOT_TOKEN",
        placeholder: "xoxb-...",
        optional: true,
        onSubmit: handleSlackToken,
      });
    }

    if (currentStep.id === "config" && phase === "ask_telegram_token") {
      prompt = e(TextPrompt, {
        question: "TELEGRAM_BOT_TOKEN",
        placeholder: "",
        optional: true,
        onSubmit: handleTelegramToken,
      });
    }

    // Profile prompts
    if (currentStep.id === "profile" && phase === "init") {
      prompt = e(ConfirmPrompt, {
        question: "Want to tell me about yourself?",
        defaultYes: true,
        onResult: handleProfileAsk,
      });
    }

    if (currentStep.id === "profile" && phase === "ask_name") {
      prompt = e(TextPrompt, {
        question: "Your name",
        placeholder: "Grant",
        onSubmit: handleProfileName,
      });
    }

    if (currentStep.id === "profile" && phase === "ask_role") {
      prompt = e(TextPrompt, {
        question: "Your role",
        placeholder: "Engineering lead",
        optional: true,
        onSubmit: handleProfileRole,
      });
    }

    if (currentStep.id === "profile" && phase === "ask_org") {
      prompt = e(TextPrompt, {
        question: "Your org",
        placeholder: "Acme Inc",
        optional: true,
        onSubmit: handleProfileOrg,
      });
    }
  }

  return e(Box, { flexDirection: "column" },
    e(WelcomeScreen, { resuming }),
    e(StepList, { steps }),
    prompt,
    finished
      ? e(Box, { flexDirection: "column", marginTop: 1, marginLeft: 2 },
          e(Text, null, ""),
          e(Text, { color: colors.green, bold: true }, "Setup complete!"),
          e(Text, { color: colors.gray }, "Run `cozy` to start chatting.")
        )
      : null
  );
}
