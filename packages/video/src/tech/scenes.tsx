import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { fitFontSize } from "../anim";
import { techMono } from "../fonts";
import { Icon } from "../Icon";
import { CONTENT_WIDTH, Stage, type SceneComponentProps } from "../scenes/common";
import { accentAt, Big, blurIn, Chip, glow, NodeBox } from "./hud";

/* Dark "tech" versions of the core scene types. The headline beat at the top carries the message;
   these scenes are the visual underneath it: glowing rings, system boxes, HUD rows and counters. */

/** Opening visual: a glowing orb of rotating rings around the topic icon, plus the subline as a status chip. */
export const TechTitleHook: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const c = style.accents;
  const orb = blurIn(frame, cue.icon ?? 0, 18);
  const sub = blurIn(frame, cue.subline);
  const size = 440;
  return (
    <Stage gap={60}>
      <div style={{ position: "relative", width: size, height: size, ...orb.style }}>
        <svg width={size} height={size} viewBox="0 0 440 440" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <circle cx={220} cy={220} r={190} fill="none" stroke={c.cyan} strokeOpacity={0.18} strokeWidth={2} />
          <g transform={`rotate(${frame * 0.6} 220 220)`}>
            <circle cx={220} cy={220} r={170} fill="none" stroke={c.cyan} strokeWidth={3} strokeDasharray="2 14" strokeLinecap="round" />
          </g>
          <g transform={`rotate(${-frame * 0.9} 220 220)`}>
            <circle cx={220} cy={220} r={140} fill="none" stroke={c.violet} strokeWidth={3} strokeDasharray="120 60" strokeLinecap="round" opacity={0.8} />
          </g>
          {Array.from({ length: 36 }, (_, i) => {
            const a = (i / 36) * Math.PI * 2;
            const lit = interpolate(frame - (cue.icon ?? 0), [i * 0.8, i * 0.8 + 6], [0.15, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return <circle key={i} cx={220 + 205 * Math.cos(a)} cy={220 + 205 * Math.sin(a)} r={3.5} fill={c.cyan} opacity={lit} />;
          })}
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 110,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(56,217,245,0.22) 0%, rgba(3,4,7,0.9) 70%)",
            boxShadow: glow(c.cyan, 1.2),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ filter: `drop-shadow(0 0 14px ${c.cyan})` }}>
            <Icon name={props.icon} size={110} color={style.colors.text} strokeWidth={1.6} />
          </div>
        </div>
      </div>
      {props.subline ? (
        <div style={sub.style}>
          <Chip color={c.orange} style={style} size={34}>
            {props.subline}
          </Chip>
        </div>
      ) : null}
    </Stage>
  );
};

/** Key terms as glowing system boxes, linked by a thin line. */
export const TechKeywordReveal: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const keywords: { id: string; text: string }[] = props.keywords;
  return (
    <Stage gap={0}>
      {keywords.map((k, i) => {
        const b = blurIn(frame, cue[k.id]);
        const color = accentAt(style, i === 0 ? 2 : i - 1);
        const size = fitFontSize(k.text, CONTENT_WIDTH - 180, 1, i === 0 ? 58 : 46, 32);
        return (
          <div key={k.id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {i > 0 ? <div style={{ width: 3, height: 70 * b.p, background: `linear-gradient(${accentAt(style, i)}, transparent)`, opacity: 0.8 }} /> : null}
            <div style={b.style}>
              <NodeBox color={color} style={style} size={size}>
                {k.text}
              </NodeBox>
            </div>
          </div>
        );
      })}
    </Stage>
  );
};

/** Steps as HUD rows: glowing index, text, and a thin accent bar. */
export const TechBulletSteps: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const items: { id: string; text: string; icon?: string }[] = props.items;
  const longest = Math.max(...items.map((i) => i.text.length));
  const size = fitFontSize("x".repeat(longest), CONTENT_WIDTH - 200, 2, 46, 34);
  const t = blurIn(frame, cue.title ?? 0);
  return (
    <Stage gap={26}>
      {props.title ? (
        <div style={{ ...t.style, alignSelf: "flex-start", marginBottom: 6 }}>
          <Chip color={style.accents.violet} style={style}>
            {props.title}
          </Chip>
        </div>
      ) : null}
      {items.map((item, i) => {
        const b = blurIn(frame, cue[item.id]);
        const color = accentAt(style, i);
        return (
          <div
            key={item.id}
            style={{
              ...b.style,
              width: CONTENT_WIDTH,
              display: "flex",
              alignItems: "center",
              gap: 28,
              padding: "24px 30px",
              borderRadius: 20,
              background: "rgba(255,255,255,0.03)",
              border: "1.5px solid rgba(255,255,255,0.08)",
              borderLeft: `4px solid ${color}`,
            }}
          >
            <div
              style={{
                width: 76,
                height: 76,
                flex: "0 0 auto",
                borderRadius: "50%",
                border: `2.5px solid ${color}`,
                boxShadow: glow(color, 0.7),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: techMono,
                fontSize: 32,
                color: style.colors.text,
              }}
            >
              {item.icon ? <Icon name={item.icon} size={38} color={color} strokeWidth={1.8} /> : i + 1}
            </div>
            <Big size={size} color={style.colors.text}>
              {item.text}
            </Big>
          </div>
        );
      })}
    </Stage>
  );
};

/** A chain of glowing nodes with a pulse travelling down the links. */
export const TechFlowchart: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const nodes: { id: string; label: string; icon?: string }[] = props.nodes;
  const link = nodes.length >= 5 ? 46 : 70;
  return (
    <Stage gap={0}>
      {nodes.map((node, i) => {
        const b = blurIn(frame, cue[node.id]);
        const color = i === nodes.length - 1 ? style.accents.orange : accentAt(style, i % 2 ? 2 : 0);
        const prevAt = cue[nodes[i - 1]?.id] ?? 0;
        const pulse = ((frame - (cue[node.id] ?? 0)) % 40) / 40;
        return (
          <div key={node.id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {i > 0 ? (
              <div style={{ position: "relative", width: 4, height: link }}>
                <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.14)", transformOrigin: "top", transform: `scaleY(${interpolate(frame, [prevAt, cue[node.id] ?? prevAt + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })})` }} />
                {b.p >= 1 ? <div style={{ position: "absolute", left: -5, top: pulse * link - 7, width: 14, height: 14, borderRadius: "50%", background: color, boxShadow: glow(color, 0.8) }} /> : null}
              </div>
            ) : null}
            <div style={b.style}>
              <NodeBox color={color} style={style} size={nodes.length >= 5 ? 30 : 36} css={{ display: "flex", alignItems: "center", gap: 22, minWidth: 560, justifyContent: "center" }}>
                {node.icon ? <Icon name={node.icon} size={44} color={color} strokeWidth={1.8} /> : null}
                <span>{node.label}</span>
              </NodeBox>
            </div>
          </div>
        );
      })}
    </Stage>
  );
};

const Panel: React.FC<{ side: { title: string; points: string[]; icon?: string }; at: number | undefined; color: string; style: SceneComponentProps["style"] }> = ({ side, at, color, style }) => {
  const frame = useCurrentFrame();
  const b = blurIn(frame, at);
  return (
    <div
      style={{
        ...b.style,
        width: 430,
        padding: "30px 28px",
        borderRadius: 24,
        background: "rgba(255,255,255,0.03)",
        border: `1.5px solid ${color}55`,
        boxShadow: `inset 0 0 40px ${color}14`,
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Icon name={side.icon} size={44} color={color} strokeWidth={1.8} />
        <div style={{ fontFamily: techMono, fontSize: 32, fontWeight: 600, color, letterSpacing: 1 }}>{side.title}</div>
      </div>
      {side.points.map((pt, i) => {
        const pb = blurIn(frame, (at ?? 0) + 8 + i * 8);
        return (
          <div key={i} style={{ ...pb.style, display: "flex", gap: 14, alignItems: "flex-start" }}>
            <span style={{ fontFamily: techMono, color, fontSize: 34, lineHeight: 1.2 }}>›</span>
            <Big size={38} color={style.colors.text}>
              {pt}
            </Big>
          </div>
        );
      })}
    </div>
  );
};

/** Two HUD panels side by side: cyan (normal) vs orange (problem). */
export const TechComparison: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const vs = blurIn(frame, cue.right);
  return (
    <Stage>
      <div style={{ display: "flex", gap: 40, alignItems: "stretch", position: "relative" }}>
        <Panel side={props.left} at={cue.left} color={style.accents.cyan} style={style} />
        <Panel side={props.right} at={cue.right} color={style.accents.orange} style={style} />
        <div style={{ ...vs.style, position: "absolute", left: "50%", top: -60, marginLeft: -40, width: 80, textAlign: "center", fontFamily: techMono, fontSize: 30, color: style.colors.muted }}>vs</div>
      </div>
    </Stage>
  );
};

/** A big glowing counter inside a ring of dots that light up as it counts. */
export const TechStatCounter: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const start = cue.value ?? 0;
  const t = interpolate(frame, [start, start + 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const value: number = props.value;
  const decimals = Number.isInteger(value) ? 0 : Math.min(2, String(value).split(".")[1]?.length ?? 0);
  const text = `${props.prefix ?? ""}${(value * t).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${props.suffix ?? ""}`;
  const finalText = `${props.prefix ?? ""}${value.toLocaleString("en-IN")}${props.suffix ?? ""}`;
  // Geist digits are wider than the generic estimate, so fit into a narrower box than the ring.
  const size = fitFontSize(finalText, 430, 1, 190, 80);
  const color = style.accents.cyan;
  const ring = blurIn(frame, start, 16);
  const label = blurIn(frame, cue.label);
  return (
    <Stage gap={44}>
      <div style={{ position: "relative", width: 620, height: 620, ...ring.style }}>
        <svg width={620} height={620} style={{ position: "absolute", inset: 0 }}>
          {Array.from({ length: 72 }, (_, i) => {
            const a = (i / 72) * Math.PI * 2 - Math.PI / 2;
            const lit = i / 72 <= t;
            return <circle key={i} cx={310 + 280 * Math.cos(a)} cy={310 + 280 * Math.sin(a)} r={lit ? 6 : 4} fill={lit ? color : "rgba(255,255,255,0.14)"} />;
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
          {props.icon ? <Icon name={props.icon} size={64} color={style.accents.orange} strokeWidth={1.8} /> : null}
          <div style={{ fontWeight: 600, fontSize: size, color: style.colors.text, letterSpacing: -4, fontVariantNumeric: "tabular-nums", textShadow: glow(color, 1.2) }}>{text}</div>
        </div>
      </div>
      <div style={label.style}>
        <Chip color={style.accents.orange} style={style} size={32}>
          {props.label}
        </Chip>
      </div>
    </Stage>
  );
};

/** Checklist recap with glowing ticks and a call-to-action chip. */
export const TechRecapOutro: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const points: { id: string; text: string }[] = props.points;
  const cta = blurIn(frame, cue.cta);
  const pulse = 1 + 0.03 * Math.sin(Math.max(0, frame - (cue.cta ?? 0)) / (fps / 5));
  return (
    <Stage gap={26}>
      {points.map((pt, i) => {
        const b = blurIn(frame, cue[pt.id]);
        const color = accentAt(style, i);
        return (
          <div key={pt.id} style={{ ...b.style, width: CONTENT_WIDTH, display: "flex", alignItems: "center", gap: 26, padding: "22px 30px", borderRadius: 20, background: "rgba(255,255,255,0.03)", border: "1.5px solid rgba(255,255,255,0.08)" }}>
            <div style={{ width: 60, height: 60, flex: "0 0 auto", borderRadius: "50%", border: `2.5px solid ${color}`, boxShadow: glow(color, 0.7), display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="check" size={34} color={color} strokeWidth={2.4} />
            </div>
            <Big size={44} color={style.colors.text}>
              {pt.text}
            </Big>
          </div>
        );
      })}
      <div style={{ ...cta.style, marginTop: 24, transform: `${cta.style.transform} scale(${pulse})` }}>
        <NodeBox color={style.accents.violet} style={style} size={34}>
          {props.cta}
        </NodeBox>
      </div>
    </Stage>
  );
};
