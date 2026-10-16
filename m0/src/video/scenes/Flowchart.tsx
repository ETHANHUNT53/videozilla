import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { enter, fitFontSize } from "../anim";
import { Icon } from "../Icon";
import { Stage, type SceneComponentProps } from "./common";

export const Flowchart: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = style.colors;
  const nodes: { id: string; label: string; icon?: string }[] = props.nodes;
  const n = nodes.length;
  const nodeHeight = n >= 5 ? 128 : n === 4 ? 150 : 170;
  const arrowHeight = n >= 5 ? 44 : 64;
  const longest = Math.max(...nodes.map((x) => x.label.length));
  const size = fitFontSize("x".repeat(longest), 600, 1, 60, 40);

  return (
    <Stage gap={0}>
      {nodes.map((node, i) => {
        const p = enter(frame, cue[node.id], fps, style.springDamping);
        // The arrow into this node draws just before the node pops in.
        const arrow = interpolate(frame, [(cue[node.id] ?? 0) - 8, (cue[node.id] ?? 0) + 2], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const color = i === n - 1 ? c.accent : c.primary;
        return (
          <div key={node.id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {i > 0 ? (
              <div style={{ height: arrowHeight, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ width: 10, height: (arrowHeight - 18) * arrow, background: c.muted, borderRadius: 5 }} />
                <div
                  style={{
                    width: 0,
                    height: 0,
                    borderLeft: "18px solid transparent",
                    borderRight: "18px solid transparent",
                    borderTop: `20px solid ${c.muted}`,
                    opacity: arrow,
                  }}
                />
              </div>
            ) : null}
            <div
              style={{
                opacity: p,
                transform: `scale(${0.7 + 0.3 * p})`,
                height: nodeHeight,
                minWidth: 620,
                display: "flex",
                alignItems: "center",
                gap: 28,
                padding: "0 44px",
                borderRadius: nodeHeight / 2,
                background: c.surface,
                border: `8px solid ${color}`,
                boxShadow: `0 20px 50px ${color}33`,
              }}
            >
              <div
                style={{
                  width: nodeHeight - 40,
                  height: nodeHeight - 40,
                  borderRadius: "50%",
                  background: color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "0 0 auto",
                }}
              >
                <Icon name={node.icon} size={(nodeHeight - 40) * 0.55} color={c.onPrimary} />
              </div>
              <div style={{ fontSize: size, fontWeight: 700, color: c.text, whiteSpace: "nowrap" }}>{node.label}</div>
            </div>
          </div>
        );
      })}
    </Stage>
  );
};
