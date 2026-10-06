const DIRECT_IMAGE=/\b(?:create|generate|make|draw|render|design|produce)\b[\s\S]{0,80}\b(?:image|picture|illustration|logo|poster|banner|thumbnail|artwork|graphic)\b|\b(?:image|picture|illustration|logo|poster|banner|thumbnail|artwork|graphic)\b[\s\S]{0,50}\b(?:create|generate|make|draw|render|design|produce)\b/i;
const CODE_IMAGE=/\b(?:script|python|javascript|typescript|code|function|class|api|endpoint|tool|plugin|generator|pipeline|implementation|implement|capability|capabilities|feature|sdk|library)\b/i;
const NEGATED=/\b(?:do not|don't|dont|without)\b[\s\S]{0,28}\b(?:generate|create|make|draw|render)\b/i;

export function classifyMediaIntent(text=''){
  const s=String(text||'').trim();
  const directImage=DIRECT_IMAGE.test(s)&&!CODE_IMAGE.test(s)&&!NEGATED.test(s);
  return{directImage,explicitCode:CODE_IMAGE.test(s)};
}
