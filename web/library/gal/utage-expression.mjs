// Small data expression grammar, never eval/Function. Utage's native conditions
// include quoted comparisons, &&/||, table names and arithmetic assignments.
export function utageExpression(source,vars={},onUnknown=()=>{}){
 const tokens=String(source).match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\d+(?:\.\d+)?|(?:[A-Za-z_][\w]*(?:\[[\w]+\])?(?:\.[\w]+)*)|==|!=|>=|<=|&&|\|\||[()+\-*/%!<>]/g)||[]
 if(tokens.join('').replace(/\s/g,'')!==String(source).replace(/\s/g,''))throw Error('Unsupported Utage expression: '+source)
 let p=0;const precedence={'||':1,'&&':2,'==':3,'!=':3,'>':4,'<':4,'>=':4,'<=':4,'+':5,'-':5,'*':6,'/':6,'%':6}
 const atom=()=>{const t=tokens[p++];if(t===undefined)throw Error('Missing Utage operand');if(t==='!')return!atom();if(t==='-')return-Number(atom());if(t==='('){const v=expr(0);if(tokens[p++]!==')')throw Error('Unclosed Utage expression');return v}if(/^['"]/.test(t))return t.slice(1,-1).replace(/\\n/g,'\n').replace(/\\(["'\\])/g,'$1');if(/^\d/.test(t))return Number(t);if(/^true$/i.test(t))return true;if(/^false$/i.test(t))return false;if(t==='null')return null;if(!Object.hasOwn(vars,t)){onUnknown(t);return 0}return vars[t]}
 const expr=min=>{let a=atom();while(p<tokens.length&&(precedence[tokens[p]]||0)>min){const op=tokens[p++],b=expr(precedence[op]);a=op==='||'?a||b:op==='&&'?a&&b:op==='=='?String(a)===String(b):op==='!='?String(a)!==String(b):op==='>'?a>b:op==='<'?a<b:op==='>='?a>=b:op==='<='?a<=b:op==='+'?Number(a)+Number(b):op==='-'?Number(a)-Number(b):op==='*'?Number(a)*Number(b):op==='/'?Number(a)/Number(b):Number(a)%Number(b)}return a}
 const out=expr(0);if(p!==tokens.length)throw Error('Unexpected Utage token: '+tokens[p]);return out
}
