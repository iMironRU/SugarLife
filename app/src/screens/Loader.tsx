import BrandDrop from '@/ui/BrandDrop';

export default function Loader({ text = 'Загрузка данных…' }: { text?: string }) {
  return (
    <div className="connect">
      <BrandDrop size={96} pulse />
      <div className="b-spin" />
      <div className="connect-desc" style={{ textAlign: 'center' }}>{text}</div>
    </div>
  );
}
