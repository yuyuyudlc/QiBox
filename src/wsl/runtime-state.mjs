import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../core/policy.mjs';
import { wslContext } from './doctor.mjs';
import { runWsl } from './wsl.mjs';
import { buildInfo } from '../core/build-info.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function clearRuntimeStateCache() {}

export async function runtimeSnapshot(policy, { wsl: providedWsl, fresh = false } = {}) {
  const wsl = providedWsl ?? (await wslContext(policy, { fresh }));
  const expectedBuild = buildInfo();
  if (!wsl.available) {
    return {
      engineAvailable: false,
      backend: 'wsl',
      distro: wsl.distro,
      reason: wsl.reason,
      exists: false,
      running: false,
      verified: false,
      codeMatches: false,
      policyMatches: false,
      expectedBuild,
      deployedBuild: null,
    };
  }

  let running = false;
  let deployedBuild = null;
  let claudeVersion = null;
  if (wsl.state === 'Running') {
    const probe = await runWsl(
      wsl.distro,
      [
        'node',
        '-e',
        `
const fs=require('fs'),net=require('net');
let build=null;try{build=JSON.parse(fs.readFileSync('/opt/isolation/build-info.json','utf8'));}catch{}
let claude=null;try{claude=require('child_process').execFileSync('claude',['--version'],{encoding:'utf8',timeout:3000}).trim();}catch{}
const s=net.createConnection('/tmp/isolation-agent/runtime.sock');
const t=setTimeout(()=>{s.destroy();console.log(JSON.stringify({running:false,build,claude}));},1500);
s.on('connect',()=>{clearTimeout(t);s.destroy();console.log(JSON.stringify({running:true,build,claude}));});
s.on('error',()=>{clearTimeout(t);console.log(JSON.stringify({running:false,build,claude}));});
`,
      ],
      { timeout: 6000, user: wsl.user },
    );
    if (probe.ok) {
      try {
        const parsed = JSON.parse(probe.stdout.trim());
        running = parsed.running === true;
        deployedBuild = parsed.build || null;
        claudeVersion = parsed.claude || null;
      } catch {}
    }
  }

  const manifest = readJson(path.join(ROOT, '.runtime', 'wsl-manifest.json'));
  const policyMatches = manifest?.policyHash === hash(policy);
  const codeMatches = deployedBuild?.runtimeFingerprint === expectedBuild.runtimeFingerprint;
  const verified = Boolean(wsl.available && wsl.dependenciesReady && running && policyMatches);

  return {
    engineAvailable: true,
    backend: 'wsl',
    distro: wsl.distro,
    user: wsl.user,
    state: wsl.state,
    version: wsl.version,
    dependenciesReady: wsl.dependenciesReady,
    claudeVersion,
    reason: wsl.reason,
    exists: wsl.dependenciesReady,
    running,
    verified,
    codeMatches,
    policyMatches,
    expectedBuild,
    deployedBuild,
  };
}
