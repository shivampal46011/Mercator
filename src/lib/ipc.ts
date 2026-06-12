import { invoke } from "@tauri-apps/api/core";
import type { DirEntry, Feature, FlowGraph, Persona } from "../types";

export const listDir = (path: string) => invoke<DirEntry[]>("list_dir", { path });

export const readFile = (path: string) => invoke<string>("read_file", { path });

export const writeFile = (path: string, content: string) =>
  invoke<void>("write_file", { path, content });

export const createFile = (path: string) => invoke<void>("create_file", { path });

export const createDir = (path: string) => invoke<void>("create_dir", { path });

export const renamePath = (from: string, to: string) => invoke<void>("rename_path", { from, to });

export const deletePath = (path: string) => invoke<void>("delete_path", { path });

export const loadProfile = (project: string) =>
  invoke<{ persona: Persona } | null>("load_profile", { project });

export const saveProfile = (project: string, persona: Persona) =>
  invoke<void>("save_profile", { project, persona });

export const scanProject = (path: string) => invoke<FlowGraph>("scan_project", { path });

export const flowAnnotate = (project: string) => invoke<number>("flow_annotate", { project });

export const flowFeatures = (project: string, force: boolean) =>
  invoke<Feature[]>("flow_features", { project, force });

export const ensureStandard = (project: string) =>
  invoke<"created" | "aligned" | "foreign">("ensure_standard", { project });
