"use server";

import { execSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";

export interface ChangelogEntry {
  hash: string;
  date: string;
  message: string;
}

export interface BuildInfo {
  hash: string;
  commitCount: string;
}

interface BakedBuildInfo extends BuildInfo {
  changelog: ChangelogEntry[];
}

// Production runs from a container image built off a clean context with NO .git
// directory (and node:22-slim has no `git` binary), so shelling out to git
// returns nothing. Instead, CI bakes a `build-info.json` into the image at build
// time (scripts/generate-build-info.mjs). Local dev has no build-info.json but
// does have .git, so we fall back to git there. Returns null when neither exists.
function readBakedBuildInfo(): BakedBuildInfo | null {
  try {
    const raw = readFileSync(path.join(process.cwd(), "build-info.json"), "utf-8");
    return JSON.parse(raw) as BakedBuildInfo;
  } catch {
    return null;
  }
}

export async function getBuildInfo(): Promise<BuildInfo> {
  const baked = readBakedBuildInfo();
  if (baked) return { hash: baked.hash, commitCount: baked.commitCount };

  try {
    const hash = execSync("git rev-parse --short HEAD", { encoding: "utf-8", timeout: 5000 }).trim();
    const commitCount = execSync("git rev-list --count HEAD", { encoding: "utf-8", timeout: 5000 }).trim();
    return { hash, commitCount };
  } catch {
    return { hash: "unknown", commitCount: "0" };
  }
}

export async function getChangelog(): Promise<ChangelogEntry[]> {
  const baked = readBakedBuildInfo();
  if (baked) return baked.changelog;

  try {
    const raw = execSync(
      'git log --no-merges --format="%h|%ad|%s" --date=format:"%d %b %Y"',
      { encoding: "utf-8", timeout: 5000 }
    );

    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, date, ...rest] = line.split("|");
        return { hash, date, message: rest.join("|") };
      });
  } catch {
    return [];
  }
}
