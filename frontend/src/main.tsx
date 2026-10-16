import { render } from 'preact';
import './style.css';

function App() {
  return (
    <main class="grid min-h-screen place-content-center bg-slate-950 text-slate-100">
      <h1 class="text-3xl font-semibold">Linquo</h1>
    </main>
  );
}

render(<App />, document.getElementById('app')!);
