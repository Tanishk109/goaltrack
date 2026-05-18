// middleware/scoring.js
// BRD Section 2.2 — Achievement score computation

function computeScore(uomType, target, actual) {
  if (!actual || actual === '' || actual === null) return 0;

  switch (uomType) {
    case 'zero':
      return parseFloat(actual) === 0 ? 100 : 0;

    case 'min':
    case 'percent': {
      const tar = parseFloat(target);
      const act = parseFloat(actual);
      if (isNaN(tar) || isNaN(act) || tar === 0) return 0;
      return Math.round((act / tar) * 10000) / 100;
    }

    case 'max': {
      const tar = parseFloat(target);
      const act = parseFloat(actual);
      if (isNaN(tar) || isNaN(act)) return 0;
      if (act === 0) return 100;
      return Math.round((tar / act) * 10000) / 100;
    }

    case 'timeline': {
      try {
        const deadline    = new Date(target);
        const completedOn = new Date(actual);
        if (isNaN(deadline) || isNaN(completedOn)) return 0;
        if (completedOn <= deadline) return 100;
        const daysLate = Math.round((completedOn - deadline) / 86400000);
        return Math.max(0, Math.round((1 - daysLate / 30) * 100));
      } catch { return 0; }
    }

    default: return 0;
  }
}

module.exports = { computeScore };
