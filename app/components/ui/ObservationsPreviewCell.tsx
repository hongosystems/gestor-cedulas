import ExpandableText from "./ExpandableText";

export default function ObservationsPreviewCell({
  text,
}: {
  text: string | null | undefined;
}) {
  return (
    <div className="obs-card-wrap">
      <ExpandableText text={text} emptyLabel="—" maxLines={4} className="obs-card-inner" />
    </div>
  );
}
