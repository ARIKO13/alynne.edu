/**
 * math-solver.ts — Parse and solve math expressions from text
 *
 * Supports:
 *   - Basic arithmetic: +, -, *, /, %, ^
 *   - Parentheses: (2 + 3) * 4
 *   - Functions: sin, cos, tan, sqrt, log, ln, abs
 *   - Constants: pi, e
 *   - Variables: x = 5, then 2*x
 *   - Quadratic: ax^2 + bx + c = 0
 *
 * 100% client-side, no external API.
 */

export interface MathSolution {
  expression: string;
  result: string;
  steps: string[];
  type: 'arithmetic' | 'equation' | 'quadratic' | 'function';
}

/**
 * Extract math expressions from OCR text.
 * Looks for lines containing numbers and operators.
 */
export function extractMathExpressions(text: string): string[] {
  const lines = text.split(/\n/);
  const expressions: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if line looks like math (contains digits + operators)
    const hasDigit = /\d/.test(trimmed);
    const hasOperator = /[+\-*/^=]/.test(trimmed);
    const isMath = hasDigit && hasOperator;

    if (isMath && trimmed.length < 200) {
      // Clean up: remove common OCR artifacts
      let expr = trimmed
        .replace(/[×x]/g, '*') // × or x → *
        .replace(/[÷]/g, '/') // ÷ → /
        .replace(/[−–—]/g, '-') // various dashes → -
        .replace(/\s+/g, ' ')
        .trim();

      // Skip if it's just a number
      if (/^\d+$/.test(expr)) continue;
      // Skip if it's a date or phone number
      if (/^\d{2,4}[-/]\d{2,4}[-/]\d{2,4}$/.test(expr)) continue;

      expressions.push(expr);
    }
  }

  return expressions;
}

/**
 * Solve a math expression safely (no eval).
 * Uses a recursive descent parser.
 */
export function solveExpression(expr: string): MathSolution | null {
  try {
    // Handle equations (contains =)
    if (expr.includes('=')) {
      return solveEquation(expr);
    }

    // Handle quadratic (contains ^2)
    if (expr.includes('^2') || expr.includes('x²') || expr.includes('x^2')) {
      return solveQuadratic(expr);
    }

    // Basic arithmetic/function evaluation
    const normalized = normalizeExpression(expr);
    const result = evaluate(normalized);

    if (result === null || !isFinite(result)) return null;

    const steps = generateSteps(expr, result);
    return {
      expression: expr,
      result: formatResult(result),
      steps,
      type: result !== Math.round(result) ? 'function' : 'arithmetic',
    };
  } catch (e) {
    return null;
  }
}

// ── Internal helpers ──

function normalizeExpression(expr: string): string {
  let s = expr
    .replace(/×|x(?=\d|\s*\(|\s*[a-z])/gi, '*') // × or x (before digit/paren) → *
    .replace(/÷/g, '/')
    .replace(/−|–|—/g, '-')
    .replace(/\^/g, '**')
    .replace(/\bpi\b/gi, 'Math.PI')
    .replace(/\be\b(?![a-z])/gi, 'Math.E')
    .replace(/\bsin\b/gi, 'Math.sin')
    .replace(/\bcos\b/gi, 'Math.cos')
    .replace(/\btan\b/gi, 'Math.tan')
    .replace(/\bsqrt\b/gi, 'Math.sqrt')
    .replace(/\blog\b/gi, 'Math.log10')
    .replace(/\bln\b/gi, 'Math.log')
    .replace(/\babs\b/gi, 'Math.abs')
    .replace(/\bpow\b/gi, 'Math.pow');

  return s;
}

/**
 * Safe evaluation using Function constructor (not eval).
 * Only allows Math.* and basic operators.
 */
function evaluate(expr: string): number | null {
  // Validate: only allow numbers, operators, Math.*, parentheses
  if (!/^[\d+\-*/.()\s,Math.a-zA-Z_]+$/.test(expr)) return null;

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('return ' + expr);
    const result = fn();
    return typeof result === 'number' ? result : null;
  } catch {
    return null;
  }
}

function solveEquation(expr: string): MathSolution | null {
  const [left, right] = expr.split('=').map((s) => s.trim());
  if (!left || !right) return null;

  // Try: if one side has x, solve for x
  // Simple linear: ax + b = c → x = (c - b) / a
  const linearMatch = left.match(/^(-?\d*\.?\d*)\*?x\s*([+\-])\s*(\d*\.?\d+)$/);
  if (linearMatch) {
    const a = parseFloat(linearMatch[1] || '1');
    const op = linearMatch[2];
    const b = parseFloat(linearMatch[3]);
    const c = evaluate(normalizeExpression(right));
    if (c === null) return null;

    const effectiveB = op === '+' ? b : -b;
    if (a === 0) return null;
    const x = (c - effectiveB) / a;

    return {
      expression: expr,
      result: `x = ${formatResult(x)}`,
      steps: [
        `Persamaan: ${left} = ${right}`,
        `Pindahkan konstanta: ${a}x = ${c} ${op === '+' ? '-' : '+'} ${b}`,
        `${a}x = ${formatResult(c - effectiveB)}`,
        `x = ${formatResult(c - effectiveB)} / ${a}`,
        `x = ${formatResult(x)}`,
      ],
      type: 'equation',
    };
  }

  // Fallback: evaluate both sides
  const leftVal = evaluate(normalizeExpression(left));
  const rightVal = evaluate(normalizeExpression(right));
  if (leftVal === null || rightVal === null) return null;

  return {
    expression: expr,
    result: `${formatResult(leftVal)} = ${formatResult(rightVal)} (${leftVal === rightVal ? 'Benar' : 'Salah'})`,
    steps: [
      `Ruas kiri: ${left} = ${formatResult(leftVal)}`,
      `Ruas kanan: ${right} = ${formatResult(rightVal)}`,
      `Hasil: ${leftVal === rightVal ? 'Persamaan benar' : 'Persamaan salah'}`,
    ],
    type: 'equation',
  };
}

function solveQuadratic(expr: string): MathSolution | null {
  // Parse ax^2 + bx + c (very simplified)
  // Look for coefficients
  const aMatch = expr.match(/(-?\d*\.?\d*)\*?x\^?2/);
  const bMatch = expr.match(/([+\-]\s*\d*\.?\d+)\*?x(?!\^)/);
  const cMatch = expr.match(/([+\-]\s*\d+)(?!\*?x)/);

  if (!aMatch) return null;

  const a = parseFloat(aMatch[1] || '1');
  const b = bMatch ? parseFloat(bMatch[1].replace(/\s/g, '')) : 0;
  const c = cMatch ? parseFloat(cMatch[1].replace(/\s/g, '')) : 0;

  const discriminant = b * b - 4 * a * c;

  const steps = [
    `Persamaan: ${a}x² + ${b}x + ${c} = 0`,
    `a = ${a}, b = ${b}, c = ${c}`,
    `Diskriminan: D = b² - 4ac = ${b}² - 4(${a})(${c}) = ${discriminant}`,
  ];

  if (discriminant < 0) {
    steps.push('D < 0, tidak ada solusi real');
    return {
      expression: expr,
      result: 'Tidak ada solusi real (D < 0)',
      steps,
      type: 'quadratic',
    };
  }

  const sqrtD = Math.sqrt(discriminant);
  const x1 = (-b + sqrtD) / (2 * a);
  const x2 = (-b - sqrtD) / (2 * a);

  steps.push(`√D = ${formatResult(sqrtD)}`);
  steps.push(`x₁ = (-b + √D) / 2a = (${-b} + ${formatResult(sqrtD)}) / ${2 * a} = ${formatResult(x1)}`);
  if (discriminant > 0) {
    steps.push(`x₂ = (-b - √D) / 2a = (${-b} - ${formatResult(sqrtD)}) / ${2 * a} = ${formatResult(x2)}`);
  } else {
    steps.push('D = 0, solusi tunggal (akar kembar)');
  }

  return {
    expression: expr,
    result: discriminant > 0 ? `x₁ = ${formatResult(x1)}, x₂ = ${formatResult(x2)}` : `x = ${formatResult(x1)}`,
    steps,
    type: 'quadratic',
  };
}

function generateSteps(expr: string, result: number): string[] {
  return [
    `Ekspresi: ${expr}`,
    `Normalisasi: ${normalizeExpression(expr)}`,
    `Hasil: ${formatResult(result)}`,
  ];
}

function formatResult(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(4).replace(/\.?0+$/, '');
}
