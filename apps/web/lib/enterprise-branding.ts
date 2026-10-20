import branding from "@/data/enterprise-branding.json";
export const enterpriseBrands = new Map(branding.brands.map(brand => [brand.code,brand]));
const badges = new Map<string,Promise<string>>();
/** Paint local logo assets into one WebGL-safe icon; fallback is visibly a name badge. */
export function enterpriseBadge(code: string, name: string, color: string, active: boolean) {
  const key = code + String(active);
  if (badges.has(key)) return badges.get(key)!;
  const promise = (async()=>{
    const canvas = document.createElement("canvas");canvas.width=240;canvas.height=120;
    const c=canvas.getContext("2d")!;
    c.fillStyle="#ffffff";c.strokeStyle=active?"#f2b84b":color;c.lineWidth=4;
    c.beginPath();c.roundRect(3,3,234,108,12);c.fill();c.stroke();
    const brand=enterpriseBrands.get(code);
    let image:HTMLImageElement|undefined;
    if(brand?.logo){try{image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=brand.logo!;});}catch{image=undefined;}}
    if(image){const ratio=Math.min(208/image.naturalWidth,58/image.naturalHeight);const w=image.naturalWidth*ratio,h=image.naturalHeight*ratio;c.drawImage(image,(240-w)/2,10+(58-h)/2,w,h);}
    else{c.fillStyle="#174d3c";c.font='bold 29px "Microsoft YaHei",sans-serif';c.textAlign="center";c.fillText(brand?.shortName||name,120,48);}
    c.fillStyle="#17382f";c.font='20px "Microsoft YaHei",sans-serif';c.textAlign="center";c.fillText(image?(brand?.shortName||name):"企业简称",120,96);
    return canvas.toDataURL("image/png");
  })();
  badges.set(key,promise);return promise;
}
