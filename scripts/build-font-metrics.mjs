// Rebuild after changing the embedded fonts. Uses the PDF writer's own TTF parser.
import {jsPDF} from 'jspdf';
import {readFileSync,writeFileSync} from 'node:fs';
for(const family of ['LiberationSerif','NotoSans']){
const metrics={};
for(const [style,weight] of Object.entries({normal:'Regular',bold:'Bold',italic:'Italic'})){
 const doc=new jsPDF(),file=`${family}-${family==='NotoSans'&&weight==='Italic'?'Regular':weight}.ttf`;
 doc.addFileToVFS(file,readFileSync(`public/fonts/${file}`).toString('base64'));doc.addFont(file,'Resume',style);doc.setFont('Resume',style);
 const font=doc.getFont().metadata,units=font.head.unitsPerEm,glyphs={};
 for(const [code,id] of Object.entries(font.cmap.unicode.codeMap)){
  if(!Number(id)||Number(code)<32||Number(code)>65535)continue;
  const glyph=font.glyf.glyphFor(Number(id));
  // jsPDF serializes CID widths as integer thousandths of an em.
  glyphs[code]=[Math.floor(font.widthOfGlyph(Number(id))),...['xMin','yMin','xMax','yMax'].map(key=>Math.round((glyph?.[key]||0)*1000/units))];
 }
 metrics[style]=glyphs;
}
writeFileSync(family==='NotoSans'?'src/shared/plumeria-font-metrics.json':'src/shared/resume-font-metrics.json',JSON.stringify(metrics)+'\n');
}
