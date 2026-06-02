/** Evita flash de tema incorrecto antes de hidratar React. */
export default function ThemeScript() {
  const script = `
(function(){
  try {
    var t = localStorage.getItem('gestor-theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
