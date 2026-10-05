/**
 * Container & kit labels (FEATUREDOCS/83) — a small, tape-on-the-case label,
 * one per container (or per kit), stacked down an A4/Letter page. Wider rather
 * than taller: the contents run in two columns so a full case stays a short
 * strip. Label models come from `container-labels.ts`; this file only draws.
 *
 * Black-and-white safe: the only colour is the org's document colour for the
 * title, the contents band and the accessory "+" markers.
 */
import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import type { DocumentData } from "@/lib/pdfme/types";
import { buildContainerLabels, buildKitLabels, type ContainerLabel, type LabelLine } from "@/lib/pdfme/container-labels";
import { COLORS, PAGE_MARGIN, lightenHex, pageSizeFor } from "./styles";

export type LabelKind = "container" | "kit";

/** Above this weight a label is allowed to break across pages instead of
 *  being kept whole (a label taller than a page can't be kept whole). */
const KEEP_WHOLE_MAX_WEIGHT = 60;

function lineWeight(line: LabelLine): number {
  return 1 + Math.ceil(line.tags.length / 4) + line.accessories.length;
}

/** Balance lines into two columns by weight, keeping order. */
export function splitColumns(lines: LabelLine[]): [LabelLine[], LabelLine[]] {
  const total = lines.reduce((s, l) => s + lineWeight(l), 0);
  const left: LabelLine[] = [];
  let acc = 0;
  let i = 0;
  while (i < lines.length && acc < total / 2) {
    acc += lineWeight(lines[i]);
    left.push(lines[i]);
    i++;
  }
  return [left, lines.slice(i)];
}

function joinDates(start: string, end: string): string {
  if (start && end) return `${start} - ${end}`;
  return start || end;
}

function Block({ caption, children, flex = 1 }: { caption: string; children: React.ReactNode; flex?: number }) {
  return (
    <View style={{ flex, backgroundColor: COLORS.headerBg, borderWidth: 0.5, borderColor: "#e2e2e2", paddingVertical: "2mm", paddingHorizontal: "3mm" }}>
      <Text style={{ fontSize: 7, color: "#777777", fontFamily: "Helvetica-Bold", marginBottom: "0.8mm" }}>{caption}</Text>
      {children}
    </View>
  );
}

function subtitleFor(label: ContainerLabel): string {
  const parts =
    label.kind === "kit"
      ? [label.tag ? `Kit · ${label.tag}` : "Kit", label.packedIn && `in ${label.packedIn}`]
      : [`${label.index} of ${label.total}`, label.tag, label.packedIn && `inside ${label.packedIn}`];
  return parts.filter(Boolean).join(" · ");
}

function logoFor(data: DocumentData): { mode: "logo" | "icon" | "none"; image: string | null } {
  const mode = data.org_branding?.documentLogoMode ?? "icon";
  if (mode === "logo") return { mode, image: data.org_logo };
  if (mode === "icon") return { mode, image: data.org_icon };
  return { mode, image: null };
}

function LabelHeader({ data, label, color }: { data: DocumentData; label: ContainerLabel; color: string }) {
  const { mode, image } = logoFor(data);
  const showOrgName = (data.org_branding?.showOrgNameOnDocuments ?? true) && !!data.org_name && !(mode === "logo" && image);
  const sub = subtitleFor(label);
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
      <View style={{ flexDirection: "row", alignItems: "center", maxWidth: "45%" }}>
        {image ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf <Image> has no alt prop.
          <Image src={image} style={{ maxWidth: mode === "logo" ? "42mm" : "12mm", maxHeight: "13mm", objectFit: "contain", marginRight: "2.5mm" }} />
        ) : null}
        {showOrgName ? (
          <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold" }}>{data.org_name}</Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", maxWidth: "55%" }}>
        <Text style={{ fontSize: 24, fontFamily: "Helvetica-Bold", color, textAlign: "right" }}>{label.title}</Text>
        <Text style={{ fontSize: 9, color: COLORS.label, marginTop: "1mm", textAlign: "right" }}>{sub}</Text>
        <Text style={{ fontSize: 9, color: COLORS.label, textAlign: "right" }}>
          {[`Job ${data.project_number}`, data.document_date].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </View>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: "0.8mm" }}>
      {tags.map((t) => (
        <Text key={t} style={{ fontSize: 7, fontFamily: "Courier", color: "#444444", marginRight: "2.2mm" }}>{t}</Text>
      ))}
    </View>
  );
}

function Line({ line, color }: { line: LabelLine; color: string }) {
  return (
    <View wrap={false} style={{ flexDirection: "row", paddingVertical: "1.6mm", borderBottomWidth: 0.5, borderBottomColor: "#e5e5e5" }}>
      <Text style={{ width: "9mm", fontFamily: "Helvetica-Bold", fontSize: 9, textAlign: "right", paddingRight: "2mm" }}>{line.qty}x</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 9 }}>{line.name}</Text>
        {line.accessoryOf ? (
          <Text style={{ fontSize: 7.5, color: "#777777", fontFamily: "Helvetica-Oblique", marginTop: "0.5mm" }}>
            accessory of {line.accessoryOf.parentName}, packed in {line.accessoryOf.parentContainerLabel}
          </Text>
        ) : null}
        <Tags tags={line.tags} />
        {line.accessories.map((a) => (
          <View key={a.name} style={{ flexDirection: "row", alignItems: "center", marginTop: "1mm", paddingLeft: "3mm" }}>
            <Text style={{ fontSize: 8, color, fontFamily: "Helvetica-Bold", marginRight: "1mm" }}>+</Text>
            <Text style={{ fontSize: 8, color: COLORS.childText }}>{a.qty}x {a.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function SingleLabel({ data, label, color }: { data: DocumentData; label: ContainerLabel; color: string }) {
  const weight = label.lines.reduce((s, l) => s + lineWeight(l), 0);
  const [left, right] = splitColumns(label.lines);
  const rental = joinDates(data.rental_start, data.rental_end);
  const event = joinDates(data.event_start, data.event_end);
  return (
    <View
      wrap={weight > KEEP_WHOLE_MAX_WEIGHT}
      style={{ borderWidth: 0.6, borderStyle: "dashed", borderColor: "#999999", paddingVertical: "5mm", paddingHorizontal: "6mm", marginBottom: "5mm" }}
    >
      <LabelHeader data={data} label={label} color={color} />
      <View style={{ flexDirection: "row", marginTop: "4mm" }}>
        <Block caption="Client">
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>{data.client_name || "-"}</Text>
        </Block>
        <View style={{ width: "3mm" }} />
        <Block caption="Project">
          <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>{data.project_name || "-"}</Text>
        </Block>
        <View style={{ width: "3mm" }} />
        <Block caption="Dates" flex={1.2}>
          {rental ? <Text style={{ fontSize: 9 }}>Rental: {rental}</Text> : null}
          {event ? <Text style={{ fontSize: 9 }}>Event: {event}</Text> : null}
        </Block>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", backgroundColor: lightenHex(color, 0.88), paddingVertical: "1.6mm", paddingHorizontal: "3mm", marginTop: "4mm" }}>
        <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color }}>Contents</Text>
        <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color }}>
          {label.lines.length} {label.lines.length === 1 ? "line" : "lines"} · {label.itemCount} {label.itemCount === 1 ? "item" : "items"}
        </Text>
      </View>
      {label.lines.length === 0 ? (
        <Text style={{ fontSize: 9, color: COLORS.label, paddingVertical: "3mm", paddingHorizontal: "3mm" }}>Nothing packed in this yet.</Text>
      ) : (
        <View style={{ flexDirection: "row" }}>
          <View style={{ flex: 1, paddingRight: "4mm" }}>{left.map((l, i) => <Line key={`l${i}`} line={l} color={color} />)}</View>
          <View style={{ flex: 1, paddingLeft: "4mm" }}>{right.map((l, i) => <Line key={`r${i}`} line={l} color={color} />)}</View>
        </View>
      )}
    </View>
  );
}

export function ContainerLabelDocument({
  data,
  kind = "container",
  labelId,
}: {
  data: DocumentData;
  kind?: LabelKind;
  /** Print just this container / kit (the container id, or the kit line item id). */
  labelId?: string;
}) {
  const color = data.org_document_color || "#0d4f4f";
  const all = kind === "kit" ? buildKitLabels(data.line_items) : buildContainerLabels(data.line_items);
  const labels = labelId ? all.filter((l) => l.id === labelId) : all;
  const noun = kind === "kit" ? "kit" : "container";

  return (
    <Document title={`${data.org_name} — ${kind === "kit" ? "Kit" : "Container"} labels ${data.project_number}`}>
      <Page
        size={pageSizeFor(data.org_paper_size)}
        wrap
        style={{ padding: PAGE_MARGIN, fontFamily: "Helvetica", fontSize: 9, color: COLORS.text }}
      >
        {labels.length === 0 ? (
          <Text style={{ fontSize: 11, color: COLORS.label }}>
            {`No ${noun}s on this job${labelId ? " match that label" : ""}.`}
          </Text>
        ) : (
          labels.map((l) => <SingleLabel key={l.id} data={data} label={l} color={color} />)
        )}
      </Page>
    </Document>
  );
}
