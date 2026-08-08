const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];

const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

// Converts a 0-999 chunk to words (used for the crore/lakh/thousand/hundred groups
// in the Indian numbering system).
function chunkToWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)];
    const ones = n % 10;
    return ones ? `${tens} ${ONES[ones]}` : tens;
  }
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return rest ? `${ONES[hundreds]} hundred and ${chunkToWords(rest)}` : `${ONES[hundreds]} hundred`;
}

// Indian numbering system: crore (10,000,000) / lakh (100,000) / thousand / hundred.
function integerToWords(n: number): string {
  if (n === 0) return 'zero';

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;

  const parts: string[] = [];
  if (crore) parts.push(`${chunkToWords(crore)} crore`);
  if (lakh) parts.push(`${chunkToWords(lakh)} lakh`);
  if (thousand) parts.push(`${chunkToWords(thousand)} thousand`);
  if (hundred) parts.push(chunkToWords(hundred));

  return parts.join(' ');
}

/**
 * Formats a rupee amount as words for printed bills, matching common Indian
 * cash-bill phrasing, e.g.:
 *   amountInWords(50) -> "Rs fifty only"
 *   amountInWords(1250.5) -> "Rs one thousand two hundred and fifty and 50 paise only"
 */
export function amountInWords(amount: number): string {
  const rupees = Math.floor(Math.round(amount * 100) / 100);
  const paise = Math.round((amount - rupees) * 100);

  const rupeeWords = integerToWords(rupees);

  if (paise > 0) {
    return `Rs ${rupeeWords} and ${paise} paise only`;
  }
  return `Rs ${rupeeWords} only`;
}
