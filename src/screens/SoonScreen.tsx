import { Obj } from '../ui/kit';

/** Раздел, который появится на следующем этапе. */
export function SoonScreen({ title, script, icon, stage, items }: { title: string; script: string; icon: string; stage: number; items: string[] }) {
  return (
    <div className="page">
      <header className="top"><div><div className="date">{script}</div><h1>{title}</h1></div></header>
      <section className="card pad soon">
        <Obj name={icon} size={150} float />
        <b className="serif">Раздел появится на этапе {stage}</b>
        <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
      </section>
    </div>
  );
}
