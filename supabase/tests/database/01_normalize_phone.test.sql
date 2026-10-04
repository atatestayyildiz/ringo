begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select is(public.normalize_tr_phone('0532 000 11 22'), '05320001122', 'boşluklu 0 ile başlayan numara');
select is(public.normalize_tr_phone('+90 (532) 000-11-22'), '05320001122', '+90 önekli biçimli numara');
select is(public.normalize_tr_phone('905320001122'), '05320001122', '90 ile başlayan 12 hane');
select is(public.normalize_tr_phone('5320001122'), '05320001122', '5 ile başlayan 10 hane');
select is(public.normalize_tr_phone('05320001122'), '05320001122', 'zaten normal numara');
select is(public.normalize_tr_phone('0532.000.11.22'), '05320001122', 'noktalı numara');
select is(public.normalize_tr_phone('0212 000 11 22'), null, 'sabit hat (02) geçersiz');
select is(public.normalize_tr_phone('532000112'), null, '9 hane geçersiz');
select is(public.normalize_tr_phone('00905320001122'), null, '14 hane geçersiz');
select is(public.normalize_tr_phone('abc'), null, 'rakamsız metin geçersiz');
select is(public.normalize_tr_phone(''), null, 'boş metin geçersiz');
select is(public.normalize_tr_phone(null), null, 'null girdi null döner');

select * from finish();
rollback;
