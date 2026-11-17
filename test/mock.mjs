// 用模擬回應測試完整流程（結構依實際官網觀察）
const T=new Date(Date.now()+8*3600e3); const pad=n=>String(n).padStart(2,'0');
const D=(n)=>{const d=new Date(T.getTime()+n*864e5);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`};
const MD=(n)=>{const [y,m,d]=D(n).split('-');return [+m,+d]};
const iso=(n,hh)=>new Date(Date.parse(D(n)+`T${hh}:00+08:00`)).toISOString();
const R={
 'capi.showtimes.com.tw/4/app/bootstrap':()=>JSON.stringify({payload:{preferenceVocabularies:{genres:[{key:'action',label:'動作'}]},
   programs:[{id:1,name:'哥吉拉-0.0',nameAlternative:'GODZILLA',coverImagePortrait:{url:'https://assets.showtimes.com.tw/images/a.jpg'},duration:8100,genres:['action'],rating:'p',availableAt:iso(-12,'00:00'),description:'<div>簡介</div>'},
             {id:2,name:'沙丘：第三部',nameAlternative:'DUNE 3',coverImagePortrait:{url:'https://x/b.jpg'},duration:9060,genres:[],rating:null,availableAt:iso(28,'00:00')}],
   corporations:[{id:91,name:'大巨蛋秀泰影城',address:'台北市信義區光復南路105號2樓'},{id:3,name:'花蓮秀泰影城',address:'花蓮市國聯五路'}],
   eventsForCorporations:{'91':{venues:[{id:9,room:'5廳'}],events:[{id:111,programId:1,startedAt:iso(0,'23:30'),status:'active',venueId:9,meta:{format:'數位 日語'}},{id:112,programId:1,startedAt:iso(1,'14:00'),status:'active',venueId:9,meta:{format:'數位 日語'}},{id:113,programId:2,startedAt:iso(28,'19:00'),status:'active',venueId:9,meta:{}}]},
     '3':{venues:[],events:[{id:200,programId:1,startedAt:iso(0,'20:00'),status:'active',venueId:1,meta:{format:'數位'}}]}}}}),
 'vscinemas.com.tw/vsweb/film/index.aspx?p=1':()=>`<ul class="movieList"><li><figure><img src="https://www.unicornpopcorn.com.tw/ForVsWeb/upload/film/g.jpg"></figure><section class="infoArea"><h2><a href="detail.aspx?id=9029">哥吉拉-0.0</a></h2><h3>GODZILLA MINUS ZERO</h3><time>${D(-12)}</time></section></li></ul>`,
 'vscinemas.com.tw/vsweb/film/index.aspx?p=2':()=>`<ul class="movieList"><li><figure><img src="x.jpg"></figure><section class="infoArea"><h2><a href="detail.aspx?id=9029">哥吉拉-0.0</a></h2></section></li></ul>`,
 'vscinemas.com.tw/vsweb/film/coming.aspx?p=1':()=>`<ul class="movieList"><li><img src="https://u/c.jpg"><section class="infoArea"><h2><a href="detail.aspx?id=9118">綻放的巴黎之星</a></h2><h3>SAMURAI</h3><time>${D(9)}</time></section></li></ul>`,
 'vscinemas.com.tw/vsweb/film/coming.aspx?p=2':()=>'<ul class="movieList"></ul>',
 'vscinemas.com.tw/vsweb/film/detail.aspx?id=9029':()=>{const [m,d]=MD(0);const [m1,d1]=MD(1);const y=D(0).slice(0,4);return `<article><p>片長： 2 時 20 分</p><p>類型： 動作</p><ul class="versionList"><li class="show"><a href="#" class="versionFirst">數位 / 日</a><ul><li><a href="#movieTime1_3_1">台北信義威秀影城</a></li><li><a href="#movieTime1_3_9">台南FOCUS 威秀影城</a></li></ul></li><li><a href="#">IMAX / 日</a><ul><li><a href="#movieTime2_3_1">台北信義威秀影城</a></li></ul></li></ul></article>
  <div class="movieTime"><article id="movieTime1_3_1" class="hidden"><div class="movieDay"><h4>${y} 年 ${m} 月 ${d} 日 星期三</h4><ul class="bookList"><li><a href="https://www.vscinemas.com.tw/vsTicketing//ticketing/booking.aspx?cinemacode=1&txtSessionId=111">22:35</a></li></ul></div><div class="movieDay"><h4>${y} 年 ${m1} 月 ${d1} 日</h4><ul class="bookList"><li><a href="/b?s=2">9:05</a></li></ul></div></article>
  <article id="movieTime1_3_9"><div class="movieDay"><h4>${y} 年 ${m} 月 ${d} 日</h4><ul class="bookList"><li><a href="/b?s=3">21:00</a></li></ul></div></article>
  <article id="movieTime2_3_1"><div class="movieDay"><h4>${y} 年 ${m} 月 ${d} 日</h4><ul class="bookList"><li><a href="/b?s=4">20:40</a></li></ul></div></article></div>`},
 'ambassador.com.tw/home/MovieList?Type=1':()=>`<div class="cell"><img src="/assets/img/movies/G.jpg"><a href="/home/MovieContent?MID=g-1&DT=x">哥吉拉-0.0</a><p class="show-for-large">Godzilla Minus Zero</p></div>`,
 'ambassador.com.tw/home/MovieList?Type=2':()=>``,
 'ambassador.com.tw/home/MovieContent?MID=g-1&DT=':(u)=>u.endsWith(D(0).replace(/-/g,'/'))?`<p>保護級</p><section class="theater-list"><div class="theater-box"><h3><a href="#">台北長春國賓影城</a></h3><span class="show-for-medium">台北市中山區長春路176號</span><p class="tag-seat">(數位‧日文版)哥吉拉-0.0</p><ul class="no-bullet seat-list"><li><h6>23:10</h6><span class="float-left info">A廳 396席</span></li></ul></div><div class="theater-box"><h3><a>金門國賓影城</a></h3><span class="show-for-medium">金門縣金城鎮</span><p class="tag-seat">(數位)哥吉拉</p><ul class="seat-list"><li><h6>21:00</h6><span class="info">1廳</span></li></ul></div></section>`:'<section></section>',
 'miramarcinemas.tw/timetable':()=>{const [m,d]=MD(0);return `<div class="timetable_list row"><div class="col"><img src="/MiramarRes/x.jpg"><div class="movie_info"><div class="title">哥吉拉-0.0</div><div class="title_en">GODZILLA</div><p class="time">片長: 135 分鐘</p><div class="badge_movie_level level_p">保護級</div><div class="description">簡介</div></div></div><div><div class="block ca59 ${m}月${d}日"><div class="room"><i>watch_later</i>IMAX</div><div class="time_area"><a class="booking_time" href="/Booking/TicketType?id=1&session=2">23:40</a></div></div></div></div>`},
 'miramarcinemas.tw/Home/startordertime':()=>{const [m,d]=MD(1),[a,b]=MD(3),[c,e]=MD(8);return `<main>美麗華影城開放訂票重要公告 ${m}/${d}（三）18:00後開放\n${a}/${b}-${c}/${e} 數位版、Dolby Cinema、IMAX場次，官網</main>`},
 'centuryasia.com.tw/Movie/GetTheaterList':()=>JSON.stringify({Data:[{item_value:'',item_name:'請選擇'},{item_value:'Kaohsiung',item_name:'高雄店'}]}),
 'centuryasia.com.tw/Movie/GetMovieList/Kaohsiung':()=>JSON.stringify({Data:[{programid:'0001185',cname:'《哥吉拉 -0.0》',ename:'G',image:'https://ticket.centuryasia.com.tw/CenturyImages/0001185.jpg',ShowTimes:'136',filmleveldesc:'輔12級',CodeName:'動作,冒險',ReleaseDate:D(-12),datedata:[{date:D(0)},{date:D(1)},{date:D(2)}]}]}),
 'centuryasia.com.tw/Movie/GetMovieAlltime/Kaohsiung/0001185/':(u)=>u.endsWith(D(2))?JSON.stringify({status:false,msg:'查無資料',Data:null}):JSON.stringify({status:true,Data:[{SubName2:'2D日語',hallname:'3廳',subtimedata:[{SubName2:'2D/日語',hallname:'3廳',showdate:u.slice(-10),'時間':'23:59',disable:false}]}]}),
 'skcinemas.com/':()=>`<div><img src="/img/p.jpg"><div><h5>哥吉拉-0.0</h5> 上映日期：${D(-12).replace(/-/g,'/')}<div class="black-text" data-action-url="/Films/FP?filmId=HO1&cinemaId=1001&isNowShowing=True">線上訂票</div></div></div>`,
 'skcinemas.com/Films/FP?filmId=HO1&cinemaId=':(u)=>u.includes('cinemaId=1001')?`<h2>哥吉拉-0.0</h2><p>保護級 135 分鐘</p><div class="sessions-view"><div class="days-info"><h5>今日場次</h5><div class="film-type"><p>數位版</p></div><div class="d-flex"><div class="session-info" data-action-url="/Booking/Booking?cinemaId=1001&filmId=HO1&sessionId=5"><p class="show-time">23:00</p><p class="end-time">01:15</p><p>2廳</p><p>剩 12 座位</p></div></div></div></div>`:'<h2>哥吉拉-0.0</h2><div class="sessions-view"></div>',
};
globalThis.fetch=async(url)=>{
  const u=String(url).replace(/^https?:\/\/(www\.)?/,'');
  const k=Object.keys(R).sort((a,b)=>b.length-a.length).find(k=>u===k||u.startsWith(k));
  if(!k)return new Response('not found '+u,{status:404});
  return new Response(R[k](u),{status:200});
};
