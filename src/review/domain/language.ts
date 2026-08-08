export const DEFAULT_REVIEW_LANGUAGE = "en";

export interface ReviewOutputLabels {
  summaryTitle: string;
  noFindings: string;
  tableHeaders: {
    severity: string;
    state: string;
    file: string;
    title: string;
  };
  states: {
    open: string;
    fixed: string;
    suppressed: string;
  };
  checkRun: {
    failedTitle: string;
    failedSummary: string;
    openFindings: string;
    blocksMerge: string;
    yes: string;
    no: string;
    blockingTitle: (count: number) => string;
    openTitle: (count: number) => string;
    emptyTitle: string;
  };
}

const OUTPUT_LABELS: Record<string, ReviewOutputLabels> = {
  en: {
    summaryTitle: "Vetter review summary",
    noFindings: "_No findings._",
    tableHeaders: { severity: "Severity", state: "State", file: "File", title: "Title" },
    states: { open: "🔴 open", fixed: "✅ fixed", suppressed: "⚪ suppressed" },
    checkRun: {
      failedTitle: "Vetter review failed",
      failedSummary: "One or more review providers failed to complete. No findings were closed for the affected scope.",
      openFindings: "Open findings",
      blocksMerge: "blocks merge",
      yes: "true",
      no: "false",
      blockingTitle: (count) => `Vetter found ${String(count)} open finding(s) blocking merge`,
      openTitle: (count) => `Vetter found ${String(count)} open finding(s)`,
      emptyTitle: "Vetter found no open findings"
    }
  },
  zh: {
    summaryTitle: "Vetter 审查摘要",
    noFindings: "_未发现问题。_",
    tableHeaders: { severity: "严重程度", state: "状态", file: "文件", title: "标题" },
    states: { open: "🔴 待处理", fixed: "✅ 已修复", suppressed: "⚪ 已抑制" },
    checkRun: {
      failedTitle: "Vetter 审查失败",
      failedSummary: "一个或多个审查提供方未能完成。受影响范围内的问题未被关闭。",
      openFindings: "未解决问题",
      blocksMerge: "阻止合并",
      yes: "是",
      no: "否",
      blockingTitle: (count) => `Vetter 发现 ${String(count)} 个阻止合并的未解决问题`,
      openTitle: (count) => `Vetter 发现 ${String(count)} 个未解决问题`,
      emptyTitle: "Vetter 未发现未解决问题"
    }
  },
  ja: {
    summaryTitle: "Vetter レビュー概要",
    noFindings: "_問題は見つかりませんでした。_",
    tableHeaders: { severity: "重大度", state: "状態", file: "ファイル", title: "タイトル" },
    states: { open: "🔴 未対応", fixed: "✅ 修正済み", suppressed: "⚪ 抑制済み" },
    checkRun: {
      failedTitle: "Vetter レビューに失敗しました",
      failedSummary: "1つ以上のレビュー provider が完了しませんでした。対象範囲の問題はクローズされていません。",
      openFindings: "未解決の問題",
      blocksMerge: "マージをブロック",
      yes: "はい",
      no: "いいえ",
      blockingTitle: (count) => `Vetter はマージをブロックする未解決の問題を ${String(count)} 件検出しました`,
      openTitle: (count) => `Vetter は未解決の問題を ${String(count)} 件検出しました`,
      emptyTitle: "Vetter は未解決の問題を検出しませんでした"
    }
  },
  ko: {
    summaryTitle: "Vetter 리뷰 요약",
    noFindings: "_문제가 없습니다._",
    tableHeaders: { severity: "심각도", state: "상태", file: "파일", title: "제목" },
    states: { open: "🔴 미해결", fixed: "✅ 수정됨", suppressed: "⚪ 억제됨" },
    checkRun: {
      failedTitle: "Vetter 리뷰 실패",
      failedSummary: "하나 이상의 리뷰 제공자가 완료되지 않았습니다. 해당 범위의 문제는 종료되지 않았습니다.",
      openFindings: "미해결 문제",
      blocksMerge: "병합 차단",
      yes: "예",
      no: "아니요",
      blockingTitle: (count) => `Vetter가 병합을 차단하는 미해결 문제 ${String(count)}개를 발견했습니다`,
      openTitle: (count) => `Vetter가 미해결 문제 ${String(count)}개를 발견했습니다`,
      emptyTitle: "Vetter가 미해결 문제를 발견하지 못했습니다"
    }
  },
  es: {
    summaryTitle: "Resumen de revisión de Vetter",
    noFindings: "_No se encontraron problemas._",
    tableHeaders: { severity: "Severidad", state: "Estado", file: "Archivo", title: "Título" },
    states: { open: "🔴 abierto", fixed: "✅ corregido", suppressed: "⚪ suprimido" },
    checkRun: {
      failedTitle: "La revisión de Vetter falló",
      failedSummary: "Uno o más proveedores de revisión no terminaron. No se cerraron problemas en el alcance afectado.",
      openFindings: "Problemas abiertos",
      blocksMerge: "bloquea la fusión",
      yes: "sí",
      no: "no",
      blockingTitle: (count) => `Vetter encontró ${String(count)} problema(s) abierto(s) que bloquean la fusión`,
      openTitle: (count) => `Vetter encontró ${String(count)} problema(s) abierto(s)`,
      emptyTitle: "Vetter no encontró problemas abiertos"
    }
  },
  fr: {
    summaryTitle: "Résumé de revue Vetter",
    noFindings: "_Aucun problème trouvé._",
    tableHeaders: { severity: "Sévérité", state: "État", file: "Fichier", title: "Titre" },
    states: { open: "🔴 ouvert", fixed: "✅ corrigé", suppressed: "⚪ supprimé" },
    checkRun: {
      failedTitle: "La revue Vetter a échoué",
      failedSummary: "Un ou plusieurs fournisseurs de revue n'ont pas terminé. Aucun problème n'a été fermé pour la portée concernée.",
      openFindings: "Problèmes ouverts",
      blocksMerge: "bloque la fusion",
      yes: "oui",
      no: "non",
      blockingTitle: (count) => `Vetter a trouvé ${String(count)} problème(s) ouvert(s) bloquant la fusion`,
      openTitle: (count) => `Vetter a trouvé ${String(count)} problème(s) ouvert(s)`,
      emptyTitle: "Vetter n'a trouvé aucun problème ouvert"
    }
  },
  de: {
    summaryTitle: "Vetter Review-Zusammenfassung",
    noFindings: "_Keine Probleme gefunden._",
    tableHeaders: { severity: "Schweregrad", state: "Status", file: "Datei", title: "Titel" },
    states: { open: "🔴 offen", fixed: "✅ behoben", suppressed: "⚪ unterdrückt" },
    checkRun: {
      failedTitle: "Vetter-Review fehlgeschlagen",
      failedSummary: "Mindestens ein Review-Anbieter wurde nicht abgeschlossen. Für den betroffenen Bereich wurden keine Probleme geschlossen.",
      openFindings: "Offene Probleme",
      blocksMerge: "blockiert den Merge",
      yes: "ja",
      no: "nein",
      blockingTitle: (count) => `Vetter hat ${String(count)} offene(s) Problem(e) gefunden, die den Merge blockieren`,
      openTitle: (count) => `Vetter hat ${String(count)} offene(s) Problem(e) gefunden`,
      emptyTitle: "Vetter hat keine offenen Probleme gefunden"
    }
  }
};

function languageFamily(language: string): string {
  const normalized = language.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "zh" || normalized.startsWith("zh-") || normalized.includes("chinese")) {
    return "zh";
  }
  if (normalized === "ja" || normalized.startsWith("ja-") || normalized.includes("japanese")) {
    return "ja";
  }
  if (normalized === "ko" || normalized.startsWith("ko-") || normalized.includes("korean")) {
    return "ko";
  }
  if (normalized === "es" || normalized.startsWith("es-") || normalized.includes("spanish")) {
    return "es";
  }
  if (normalized === "fr" || normalized.startsWith("fr-") || normalized.includes("french")) {
    return "fr";
  }
  if (normalized === "de" || normalized.startsWith("de-") || normalized.includes("german")) {
    return "de";
  }
  return "en";
}

export function getReviewOutputLabels(language?: string): ReviewOutputLabels {
  return OUTPUT_LABELS[languageFamily(language ?? DEFAULT_REVIEW_LANGUAGE)] ?? OUTPUT_LABELS.en!;
}
