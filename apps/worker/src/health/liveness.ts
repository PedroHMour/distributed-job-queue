import { writeFileSync } from 'fs';
import { logger } from '../lib/logger.js';

const LIVENESS_FILE = '/tmp/worker-alive';
const HEARTBEAT_INTERVAL_MS = 30_000; // escreve a cada 30s

let heartbeatTimer: NodeJS.Timeout | null = null;

/**
 * Liveness probe para workers sem servidor HTTP.
 *
 * Escreve um timestamp em /tmp/worker-alive a cada 30 segundos.
 * O Docker healthcheck verifica se o arquivo foi atualizado nos últimos 60s.
 * Se o worker travar silenciosamente (deadlock, event loop bloqueado),
 * o arquivo para de ser atualizado e o Docker reinicia o container.
 *
 * Por que arquivo em disco e não HTTP?
 * Workers não têm servidor HTTP — abrir uma porta só para health check
 * adiciona complexidade sem benefício. Arquivo em /tmp é simples,
 * confiável e padrão em sistemas Unix.
 */
export function startLivenessProbe(): void {
  // Escreve imediatamente no startup para o primeiro healthcheck passar
  writeBeat();

  heartbeatTimer = setInterval(() => {
    writeBeat();
  }, HEARTBEAT_INTERVAL_MS);

  // Não impede o processo de encerrar no shutdown gracioso
  heartbeatTimer.unref();

  logger.info(
    { file: LIVENESS_FILE, intervalMs: HEARTBEAT_INTERVAL_MS },
    'Liveness probe iniciado'
  );
}

export function stopLivenessProbe(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    logger.info('Liveness probe encerrado');
  }
}

function writeBeat(): void {
  try {
    writeFileSync(LIVENESS_FILE, Date.now().toString(), 'utf-8');
  } catch (err) {
    // Não lança — uma falha ao escrever não deve derrubar o worker
    // O Docker vai detectar o arquivo desatualizado e reiniciar
    logger.error({ err }, 'Falha ao escrever liveness file');
  }
}