import * as FileSystem from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import JSZip from "jszip";
import { Project } from "../types";

export async function pickAndLoadProject(): Promise<{
  project: Project;
  mediaDir: string;
} | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true
  });

  if (res.canceled) return null;

  const fileUri = res.assets[0].uri;
  const zipData = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64
  });

  const zip = await JSZip.loadAsync(zipData, { base64: true });

  // project.json
  const projectText = await zip.file("project.json")!.async("string");
  const project = JSON.parse(projectText);

  // media/*
  const mediaDir = FileSystem.cacheDirectory + "branchpro-media/";
  await FileSystem.makeDirectoryAsync(mediaDir, { intermediates: true });

  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith("media/")) continue;

    const file = zip.files[name];
    if (file.dir) continue;

    const buf = await file.async("base64");
    const outPath = mediaDir + name.replace("media/", "");

    await FileSystem.writeAsStringAsync(outPath, buf, {
      encoding: FileSystem.EncodingType.Base64
    });
  }

  return { project, mediaDir };
}
