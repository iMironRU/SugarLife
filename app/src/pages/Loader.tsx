export default function Loader({ text = 'Загрузка данных…' }: { text?: string }) {
  return (
    <div className="connect">
      <div className="b-ring"><span>5,8</span></div>
      <div className="b-spin" />
      <div className="connect-desc" style={{ textAlign: 'center' }}>{text}</div>
    </div>
  );
}
