import { useState } from "react";
import { View, Text, Button, Image } from "react-native";
import { pickAndLoadProject } from "./src/engine/loader";
import { buildIndex } from "./src/engine/graph";
import { Node } from "./src/types";

export default function App() {
  const [node, setNode] = useState<Node | null>(null);
  const [engine, setEngine] = useState<any>(null);
  const [mediaDir, setMediaDir] = useState<string>("");

  const openProject = async () => {
    const res = await pickAndLoadProject();
    if (!res) return;

    const eng = buildIndex(res.project);
    setEngine(eng);
    setMediaDir(res.mediaDir);
    setNode(eng.getStartNode());
  };

  if (!node) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Button title="Открыть проект" onPress={openProject} />
      </View>
    );
  }

  if (node.data.kind === "question") {
    return (
      <View style={{ padding: 20 }}>
        <Text style={{ fontSize: 20 }}>{node.data.title}</Text>

        {node.data.mediaList?.map((m, i) =>
          m.type === "image" ? (
            <Image
              key={i}
              source={{ uri: mediaDir + m.path.replace("media/", "") }}
              style={{ width: "100%", height: 200 }}
            />
          ) : null
        )}

        {node.data.answers.map(a => (
          <Button
            key={a.id}
            title={a.text}
            onPress={() => {
              const next = engine.getNextNode(node, a.id);
              if (next) setNode(next);
            }}
          />
        ))}
      </View>
    );
  }

  // ending
  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 22 }}>{node.data.title}</Text>
      <Text>{node.data.resultText}</Text>
      <Button title="Начать заново" onPress={openProject} />
    </View>
  );
}
