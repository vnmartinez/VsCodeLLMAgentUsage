// Verificação manual com dados reais. Imprime só o view model (sem tokens).
import { buildViewModel, createDefaultCollector } from '../src/index';

const collector = createDefaultCollector();
await collector.start();
collector.stop();
console.log(JSON.stringify(buildViewModel(collector.current(), new Date()), null, 2));
