import { useState } from 'react';
import { FA_MONTHS, faDate, gregorianToJalali, isoWeekday, jalaliInputToISO, jalaliToGregorian, toFaDigits } from './jalali';

type Props = { value: string; onChange: (iso: string) => void; label: string; required?: boolean; name?: string };
function monthDays(year:number,month:number){ for(let day=31;day>=29;day--) if(jalaliInputToISO(`${year}/${month}/${day}`)) return day; return 29; }
export default function JalaliDatePicker({value,onChange,label,required=false,name}:Props){
 const selected=value?gregorianToJalali(...value.slice(0,10).split('-').map(Number) as [number,number,number]):gregorianToJalali(...new Date().toISOString().slice(0,10).split('-').map(Number) as [number,number,number]);
 const [open,setOpen]=useState(false);const [year,setYear]=useState(selected[0]);const [month,setMonth]=useState(selected[1]);
 const move=(delta:number)=>{let y=year,m=month+delta;if(m<1){m=12;y--}if(m>12){m=1;y++}setYear(y);setMonth(m)};
 const now=new Date();const todayJ=gregorianToJalali(now.getFullYear(),now.getMonth()+1,now.getDate());
 const first=jalaliInputToISO(`${year}/${month}/1`)!;const offset=(isoWeekday(first)+1)%7;const days=monthDays(year,month);
 const grid=Array.from({length:Math.ceil((offset+days)/7)*7},(_,i)=>{const d=i-offset+1;return d<1||d>days?null:d});
 return <div className="jalali-picker"><span className="date-label">{label}{required?' *':''}</span><button type="button" className="date-picker-trigger" aria-expanded={open} onClick={()=>{if(!open){setYear(selected[0]);setMonth(selected[1])}setOpen(!open)}}>{value?faDate(value):'انتخاب تاریخ شمسی'} <span>▦</span></button>{name&&<input type="hidden" name={name} value={value?`${selected[0]}/${selected[1]}/${selected[2]}`:''} />}{required&&<input className="date-required" tabIndex={-1} aria-hidden="true" required value={value?'selected':''} onChange={()=>{}}/>}
 {open&&<div className="jalali-calendar" dir="rtl"><div className="calendar-head"><button type="button" aria-label="ماه قبل" onClick={()=>move(-1)}>‹</button><strong>{FA_MONTHS[month-1]} {toFaDigits(year)}</strong><button type="button" aria-label="ماه بعد" onClick={()=>move(1)}>›</button></div><div className="calendar-grid">{['ش','ی','د','س','چ','پ','ج'].map((x,i)=><b className="weekday" key={i}>{x}</b>)}{grid.map((d,i)=>d===null?<span key={i}/>:<button type="button" key={i} className={[selected[0]===year&&selected[1]===month&&selected[2]===d?'chosen':'',todayJ[0]===year&&todayJ[1]===month&&todayJ[2]===d?'today':''].filter(Boolean).join(' ')} onClick={()=>{const iso=jalaliInputToISO(`${year}/${month}/${d}`);if(iso)onChange(iso);setOpen(false)}}>{toFaDigits(d)}</button>)}</div><button type="button" className="calendar-today" onClick={()=>{const now=new Date();const jy=gregorianToJalali(now.getFullYear(),now.getMonth()+1,now.getDate());const iso=jalaliInputToISO(jy.join('/'));if(iso)onChange(iso);setYear(jy[0]);setMonth(jy[1]);setOpen(false)}}>امروز</button></div>}</div>
}
