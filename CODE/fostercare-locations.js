/* FosterCare Connect shared location controls. No external dependencies. */
(function () {
'use strict';
const locations = {
 'Eastern Cape': {'Buffalo City (Metro)':['East London','Qonce','Bhisho','Mdantsane'],'Nelson Mandela Bay (Metro)':['Gqeberha','Kariega','Despatch'],'OR Tambo':['Mthatha','Libode','Port St Johns','Qumbu'],'Amathole':['Butterworth','Dutywa','Alice','Fort Beaufort'],'Chris Hani':['Komani','Cradock','Cofimvaba'],'Joe Gqabi':['Aliwal North','Barkly East','Mount Fletcher'],'Sarah Baartman':['Makhanda','Jeffreys Bay','Humansdorp','Graaff-Reinet'],'Alfred Nzo':['Mount Ayliff','Mount Frere','Bizana']},
 'Free State':{'Mangaung (Metro)':['Bloemfontein','Botshabelo','Thaba Nchu'],'Fezile Dabi':['Sasolburg','Parys','Kroonstad'],'Lejweleputswa':['Welkom','Virginia','Bothaville'],'Thabo Mofutsanyana':['Bethlehem','Harrismith','Phuthaditjhaba'],'Xhariep':['Trompsburg','Jagersfontein']},
 'Gauteng':{'City of Johannesburg (Metro)':['Johannesburg','Soweto','Sandton','Randburg'],'City of Tshwane (Metro)':['Pretoria','Centurion','Mamelodi','Soshanguve'],'Ekurhuleni (Metro)':['Germiston','Benoni','Boksburg','Kempton Park'],'Sedibeng':['Vereeniging','Vanderbijlpark','Meyerton'],'West Rand':['Krugersdorp','Randfontein','Carletonville']},
 'KwaZulu-Natal':{'eThekwini (Metro)':['Durban','Pinetown','Umhlanga','KwaMashu'],'uMgungundlovu':['Pietermaritzburg','Howick','Mooi River'],'King Cetshwayo':['Richards Bay','Empangeni','Eshowe'],'iLembe':['KwaDukuza','Ballito','Mandeni'],'Ugu':['Port Shepstone','Margate'],'uThukela':['Ladysmith','Estcourt'],'Amajuba':['Newcastle','Dannhauser'],'Zululand':['Ulundi','Vryheid'],'uMkhanyakude':['Jozini','Hluhluwe'],'uMzinyathi':['Dundee','Greytown'],'Harry Gwala':['Ixopo','Kokstad']},
 'Limpopo':{'Capricorn':['Polokwane','Seshego'],'Mopani':['Tzaneen','Phalaborwa','Giyani'],'Sekhukhune':['Burgersfort','Groblersdal'],'Vhembe':['Thohoyandou','Musina','Louis Trichardt'],'Waterberg':['Lephalale','Modimolle','Bela-Bela']},
 'Mpumalanga':{'Ehlanzeni':['Mbombela','White River','Hazyview'],'Gert Sibande':['Secunda','Ermelo','Standerton'],'Nkangala':['Emalahleni','Middelburg','KwaMhlanga']},
 'North West':{'Bojanala Platinum':['Rustenburg','Brits'],'Dr Kenneth Kaunda':['Klerksdorp','Potchefstroom'],'Dr Ruth Segomotsi Mompati':['Vryburg','Taung'],'Ngaka Modiri Molema':['Mahikeng','Lichtenburg','Zeerust']},
 'Northern Cape':{'Frances Baard':['Kimberley','Barkly West'],'John Taolo Gaetsewe':['Kuruman','Kathu'],'Namakwa':['Springbok','Calvinia'],'Pixley ka Seme':['De Aar','Colesberg'],'ZF Mgcawu':['Upington','Kakamas']},
 'Western Cape':{'City of Cape Town (Metro)':['Cape Town','Bellville','Khayelitsha','Mitchells Plain'],'Cape Winelands':['Stellenbosch','Paarl','Worcester'],'Central Karoo':['Beaufort West','Prince Albert'],'Garden Route':['George','Knysna','Mossel Bay'],'Overberg':['Hermanus','Caledon'],'West Coast':['Saldanha','Vredenburg','Malmesbury']}
};
const byId=id=>document.getElementById(id);
const setOptions=(select,values,placeholder)=>{
 if(!select)return;
 select.replaceChildren();
 const first=document.createElement('option');first.value='';first.textContent=placeholder;select.appendChild(first);
 values.forEach(value=>{const o=document.createElement('option');o.value=value;o.textContent=value;select.appendChild(o);});
};
const instances={};
function init(prefix){
 if(instances[prefix])return;
 const province=byId(prefix+'Province'),district=byId(prefix+'District'),town=byId(prefix+'Town'),hidden=byId(prefix+'Region'),other=byId(prefix+'OtherTown'),row=byId(prefix+'OtherTownRow');
 if(!province||!district||!town||!hidden)return;
 const updateHidden=()=>{
  const value=town.value==='__other__'?(other?.value.trim()||''):town.value;
  hidden.value=value ? [province.value,district.value,value].join(' | ') : '';
  if(row)row.style.display=town.value==='__other__'?'':'none';
 };
 const updateTown=()=>{const values=(locations[province.value]||{})[district.value]||[];setOptions(town,[...values,'__other__'],'Select town / city');const opt=[...town.options].find(o=>o.value==='__other__');if(opt)opt.textContent='Other town/city';town.disabled=!district.value;updateHidden();};
 const updateDistrict=()=>{setOptions(district,Object.keys(locations[province.value]||{}),'Select district / metro');district.disabled=!province.value;updateTown();};
 setOptions(province,Object.keys(locations),'Select province');updateDistrict();
 province.addEventListener('change',updateDistrict);district.addEventListener('change',updateTown);town.addEventListener('change',updateHidden);other?.addEventListener('input',updateHidden);
 instances[prefix]={province,district,town,hidden,other,row,updateDistrict,updateTown,updateHidden};
}
function restore(prefix,stored){init(prefix);const c=instances[prefix];if(!c)return;
 const raw=String(stored||'').trim();if(!raw)return;
 const parts=raw.split(/\s*\|\s*/);
 let prov='',dist='',city='';
 if(parts.length>=3){[prov,dist,city]=parts;}
 else {
  city=raw;
  outer:for(const [p,ds] of Object.entries(locations))for(const [d,ts] of Object.entries(ds)){
   if(ts.some(t=>t.toLowerCase()===raw.toLowerCase())||d.toLowerCase()===raw.toLowerCase()) {prov=p;dist=d;break outer;}
  }
 }
 if(!locations[prov]||!locations[prov][dist]){c.hidden.value=raw;return;}
 c.province.value=prov;c.updateDistrict();c.district.value=dist;c.updateTown();
 if(city && [...c.town.options].some(o=>o.value===city))c.town.value=city;
 else if(city){c.town.value='__other__';if(c.other)c.other.value=city;}
 c.updateHidden();
}
function validate(prefix,required){init(prefix);const c=instances[prefix];if(!c)return true;
 if(!c.province.value&&!c.district.value&&!c.town.value)return !required;
 if(!c.province.value||!c.district.value||!c.town.value||(c.town.value==='__other__'&&!c.other?.value.trim())){
  alert('Please select a province, district and town/city.');return false;
 }
 c.updateHidden();return true;
}
function initDistrictOnly(prefix){
 const p=byId(prefix+'Province'),d=byId(prefix+'District');if(!p||!d)return;
 setOptions(p,Object.keys(locations),'Select province');
 setOptions(d,[],'Select district / metro');d.disabled=true;
 p.addEventListener('change',()=>{setOptions(d,Object.keys(locations[p.value]||{}),'Select district / metro');d.disabled=!p.value;});
}
window.FosterLocations={init,restore,validate,initDistrictOnly};
})();
