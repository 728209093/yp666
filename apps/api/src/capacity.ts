// Rejected work is never queued, so pending request bodies cannot grow without bound.
export class CapacityGate {
  private active = 0;
  private readonly perKey = new Map<string,number>();

  constructor(private readonly maximumActive:number, private readonly maximumPerKey:number) {}

  acquire(keys:readonly string[]): (()=>void) | null {
    const distinct=[...new Set(keys)];
    if(this.active>=this.maximumActive || distinct.some(key=>(this.perKey.get(key)||0)>=this.maximumPerKey))return null;
    this.active++;
    for(const key of distinct)this.perKey.set(key,(this.perKey.get(key)||0)+1);
    let released=false;
    return ()=>{
      if(released)return;
      released=true;
      this.active--;
      for(const key of distinct){
        const remaining=(this.perKey.get(key)||1)-1;
        if(remaining)this.perKey.set(key,remaining);else this.perKey.delete(key);
      }
    };
  }
}
