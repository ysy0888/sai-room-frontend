part of 'main.dart';

DateTime seoulNow() => DateTime.now().toUtc().add(const Duration(hours: 9));
DateTime dayOnly(DateTime d) => DateTime(d.year, d.month, d.day);
String dateKey(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
String clockText(int m) =>
    '${(m ~/ 60).toString().padLeft(2, '0')}:${(m % 60).toString().padLeft(2, '0')}';
const weekdays = ['월', '화', '수', '목', '금', '토', '일'];

class SchedulePage extends StatefulWidget {
  final AppState m;
  const SchedulePage(this.m, {super.key});
  @override
  State<SchedulePage> createState() => _SchedulePageState();
}

class _SchedulePageState extends State<SchedulePage> {
  DateTime selected = dayOnly(seoulNow());
  int start = 1200, end = 1260;
  bool week = true;
  DateTime get monday =>
      selected.subtract(Duration(days: selected.weekday - 1));
  @override
  Widget build(BuildContext c) {
    final bookings = widget.m.bookings;
    final dayBookings = bookings
        .where((b) => b['date'] == dateKey(selected))
        .toList();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: [
              IconButton(
                tooltip: '이전 주',
                onPressed: () => setState(
                  () => selected = selected.subtract(const Duration(days: 7)),
                ),
                icon: const Icon(Icons.chevron_left),
              ),
              Expanded(
                child: TextButton(
                  onPressed: () async {
                    final d = await showDatePicker(
                      context: c,
                      initialDate: selected,
                      firstDate: DateTime(2020),
                      lastDate: DateTime(2100),
                    );
                    if (d != null) setState(() => selected = d);
                  },
                  child: Text(
                    '${selected.year}년 ${selected.month}월',
                    style: const TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
              IconButton(
                tooltip: '다음 주',
                onPressed: () => setState(
                  () => selected = selected.add(const Duration(days: 7)),
                ),
                icon: const Icon(Icons.chevron_right),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Row(
            children: [
              TextButton(
                onPressed: () => setState(() => selected = dayOnly(seoulNow())),
                child: const Text('오늘'),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.all(3),
                decoration: BoxDecoration(
                  color: Theme.of(c).colorScheme.primary.withValues(alpha: .05),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    for (final value in [true, false])
                      SizedBox(
                        width: 52,
                        height: 32,
                        child: TextButton(
                          style: TextButton.styleFrom(
                            padding: EdgeInsets.zero,
                            backgroundColor: week == value
                                ? Theme.of(c).colorScheme.surface
                                : Colors.transparent,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(7),
                            ),
                          ),
                          onPressed: () => setState(() => week = value),
                          child: Text(
                            value ? '주간' : '일간',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: week == value
                                  ? FontWeight.w700
                                  : FontWeight.w400,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        gap(10),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18),
          child: Row(
            children: [
              const SizedBox(width: 34),
              for (var i = 0; i < 7; i++)
                Expanded(
                  child: Builder(
                    builder: (c) {
                      final d = monday.add(Duration(days: i)),
                          chosen = dateKey(d) == dateKey(selected);
                      return InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: () => setState(() => selected = d),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 7),
                          child: Column(
                            children: [
                              Text(
                                weekdays[i],
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: muted,
                                ),
                              ),
                              gap(5),
                              Container(
                                width: 33,
                                height: 33,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  color: chosen
                                      ? Theme.of(c).colorScheme.primary
                                      : Colors.transparent,
                                  shape: BoxShape.circle,
                                ),
                                child: Text(
                                  '${d.day}',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w700,
                                    color: chosen
                                        ? Theme.of(c).colorScheme.onPrimary
                                        : null,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 10, 18, 18),
            children: [
              LayoutBuilder(
                builder: (c, constraints) {
                  final days = week
                      ? List.generate(7, (i) => monday.add(Duration(days: i)))
                      : [selected];
                  final column = (constraints.maxWidth - 34) / days.length;
                  final slotHeight = week ? 12.0 : 32.0;
                  final gridHeight = 28 * slotHeight;
                  return SizedBox(
                    height: gridHeight + 14,
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        for (var i = 0; i <= 28; i++) ...[
                          if (i % 2 == 0)
                            Positioned(
                              left: 0,
                              top: i * slotHeight - 7,
                              width: 32,
                              child: Text(
                                clockText(540 + i * 30),
                                style: const TextStyle(
                                  fontSize: 10,
                                  color: muted,
                                ),
                              ),
                            ),
                          Positioned(
                            left: 34,
                            right: 0,
                            top: i * slotHeight,
                            child: Container(
                              height: .6,
                              color: Theme.of(c).dividerColor,
                            ),
                          ),
                        ],
                        for (var d = 0; d < days.length; d++) ...[
                          Positioned(
                            left: 34 + d * column,
                            top: 0,
                            bottom: 14,
                            width: column,
                            child: Container(
                              decoration: BoxDecoration(
                                border: Border(
                                  left: BorderSide(
                                    color: Theme.of(c).dividerColor,
                                    width: .6,
                                  ),
                                ),
                              ),
                              child: Column(
                                children: [
                                  for (var i = 0; i < 28; i++)
                                    SizedBox(
                                      height: slotHeight,
                                      child: Semantics(
                                        button: true,
                                        label:
                                            '${days[d].month}월 ${days[d].day}일 ${clockText(540 + i * 30)} 선택',
                                        child: InkWell(
                                          onTap: () => setState(() {
                                            selected = days[d];
                                            start = 540 + i * 30;
                                            end = (start + 60).clamp(570, 1380);
                                          }),
                                          child: Container(
                                            color:
                                                dateKey(selected) ==
                                                        dateKey(days[d]) &&
                                                    540 + i * 30 >= start &&
                                                    540 + i * 30 < end
                                                ? Theme.of(c)
                                                      .colorScheme
                                                      .primary
                                                      .withValues(alpha: .08)
                                                : null,
                                          ),
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ),
                          for (final b in bookings.where(
                            (b) => b['date'] == dateKey(days[d]),
                          ))
                            Positioned(
                              left: 35 + d * column,
                              top: (b['start'] - 540) / 30 * slotHeight + 1,
                              width: column - 2,
                              height:
                                  (b['end'] - b['start']) / 30 * slotHeight - 2,
                              child: Semantics(
                                button: true,
                                label:
                                    '${b['purpose']} ${clockText(b['start'])}부터 ${clockText(b['end'])}',
                                child: InkWell(
                                  onTap: () =>
                                      open(c, BookingDetail(widget.m, b)),
                                  child: Container(
                                    padding: EdgeInsets.all(week ? 3 : 8),
                                    clipBehavior: Clip.hardEdge,
                                    decoration: BoxDecoration(
                                      color: b['owner'] == 'me'
                                          ? const Color(0xfff9e8ef)
                                          : const Color(0xffe4ebf8),
                                      border: Border.all(
                                        color: b['owner'] == 'me'
                                            ? const Color(0xffd58ca4)
                                            : const Color(0xffb4c4df),
                                      ),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: Text(
                                      week
                                          ? b['purpose']
                                          : '${b['purpose']}\n${clockText(b['start'])}–${clockText(b['end'])}',
                                      maxLines: week ? 2 : 4,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        color: b['owner'] == 'me' ? red : navy,
                                        fontSize: week ? 10 : 13,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ],
                    ),
                  );
                },
              ),
              gap(8),
              Row(
                children: [
                  const Icon(Icons.circle, size: 7, color: Color(0xffc1718e)),
                  const SizedBox(width: 5),
                  note('내 예약'),
                  const SizedBox(width: 14),
                  const Icon(Icons.circle, size: 7, color: Color(0xffb4c4df)),
                  const SizedBox(width: 5),
                  note('다른 예약'),
                  const Spacer(),
                  note('30분 단위'),
                ],
              ),
              section(
                '${selected.month}월 ${selected.day}일 (${weekdays[selected.weekday - 1]})',
              ),
              if (dayBookings.isEmpty) note('예약된 일정이 없습니다.'),
              for (final b in dayBookings)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    b['purpose'],
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                  ),
                  subtitle: Text(
                    '${clockText(b['start'])}–${clockText(b['end'])} · ${b['people']}명',
                    style: const TextStyle(fontSize: 12),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => open(c, BookingDetail(widget.m, b)),
                ),
            ],
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: Theme.of(c).colorScheme.surface,
            border: Border(top: BorderSide(color: Theme.of(c).dividerColor)),
          ),
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 14),
          child: Column(
            children: [
              Row(
                children: [
                  note('시작'),
                  const SizedBox(width: 8),
                  Expanded(
                    child: timeSelect(
                      start,
                      (v) => setState(() {
                        start = v;
                        if (end <= v) end = (v + 60).clamp(570, 1380);
                      }),
                      startTime: true,
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 8),
                    child: Text('–'),
                  ),
                  note('종료'),
                  const SizedBox(width: 8),
                  Expanded(
                    child: timeSelect(
                      end,
                      (v) => setState(() => end = v),
                      after: start,
                    ),
                  ),
                ],
              ),
              gap(7),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => open(
                    c,
                    BookingForm(
                      widget.m,
                      date: selected,
                      start: start,
                      end: end,
                    ),
                  ),
                  child: const Text('예약하기'),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

Widget timeSelect(
  int value,
  ValueChanged<int> change, {
  bool startTime = false,
  int after = 540,
}) => Builder(
  builder: (context) => DropdownButtonHideUnderline(
    child: DropdownButton<int>(
      value: value,
      isExpanded: true,
      style: TextStyle(
        fontFamily: 'NotoSansKR',
        fontSize: 15,
        fontWeight: FontWeight.w700,
        color: Theme.of(context).colorScheme.onSurface,
      ),
      items: [
        for (
          int i = startTime ? 540 : 570;
          i <= (startTime ? 1350 : 1380);
          i += 30
        )
          if (startTime || i > after || i == value)
            DropdownMenuItem(value: i, child: Text(clockText(i))),
      ],
      onChanged: (v) {
        if (v != null) change(v);
      },
    ),
  ),
);

class BookingForm extends StatefulWidget {
  final AppState m;
  final DateTime date;
  final int start, end;
  final Json? booking;
  const BookingForm(
    this.m, {
    super.key,
    required this.date,
    required this.start,
    required this.end,
    this.booking,
  });
  @override
  State<BookingForm> createState() => _BookingFormState();
}

class _BookingFormState extends State<BookingForm> {
  late DateTime date;
  late int start, end, people;
  late TextEditingController purpose, name;
  final form = GlobalKey<FormState>();
  @override
  void initState() {
    super.initState();
    date = widget.date;
    start = widget.start;
    end = widget.end;
    people = widget.booking?['people'] ?? 1;
    purpose = TextEditingController(text: widget.booking?['purpose'] ?? '');
    name = TextEditingController(
      text: widget.booking?['name'] ?? widget.m.user?['displayName'] ?? '',
    );
  }

  @override
  void dispose() {
    purpose.dispose();
    name.dispose();
    super.dispose();
  }

  @override
  Widget build(
    BuildContext c,
  ) => Sheet(widget.booking == null ? '예약하기' : '예약 변경', [
    Form(
      key: form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('${date.year}년 ${date.month}월 ${date.day}일'),
            trailing: const Icon(Icons.calendar_month_outlined),
            onTap: () async {
              final d = await showDatePicker(
                context: c,
                initialDate: date.isBefore(dayOnly(seoulNow()))
                    ? dayOnly(seoulNow())
                    : date,
                firstDate: dayOnly(seoulNow()),
                lastDate: dayOnly(seoulNow()).add(const Duration(days: 365)),
              );
              if (d != null) setState(() => date = d);
            },
          ),
          Row(
            children: [
              Expanded(
                child: timeSelect(
                  start,
                  (v) => setState(() {
                    start = v;
                    if (end <= v) end = v + 30;
                  }),
                  startTime: true,
                ),
              ),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 24),
                child: Text('—'),
              ),
              Expanded(
                child: timeSelect(
                  end,
                  (v) => setState(() => end = v),
                  after: start,
                ),
              ),
            ],
          ),
          gap(),
          TextFormField(
            controller: purpose,
            maxLength: 60,
            decoration: const InputDecoration(labelText: '이용 목적'),
            validator: (v) =>
                v == null || v.trim().isEmpty ? '이용 목적을 입력해주세요.' : null,
          ),
          gap(12),
          TextFormField(
            controller: name,
            maxLength: 40,
            decoration: const InputDecoration(labelText: '예약자'),
            validator: (v) =>
                v == null || v.trim().isEmpty ? '예약자를 입력해주세요.' : null,
          ),
          gap(12),
          DropdownButtonFormField<int>(
            initialValue: people,
            decoration: const InputDecoration(labelText: '사용 인원'),
            items: [
              for (var i = 1; i <= 15; i++)
                DropdownMenuItem(value: i, child: Text('$i명')),
            ],
            onChanged: (v) => people = v ?? 1,
          ),
          gap(28),
          ActionButton(widget.booking == null ? '예약 완료' : '변경 내용 저장', () async {
            if (!form.currentState!.validate()) return;
            await widget.m.mutate(
              widget.booking == null
                  ? '/bookings'
                  : '/bookings/${widget.booking!['id']}',
              method: widget.booking == null ? 'POST' : 'PATCH',
              body: {
                'roomId': 'sai-room',
                'date': dateKey(date),
                'start': start,
                'end': end,
                'purpose': purpose.text.trim(),
                'name': name.text.trim(),
                'people': people,
              },
            );
            if (c.mounted) Navigator.pop(c);
          }),
        ],
      ),
    ),
  ]);
}

class BookingDetail extends StatelessWidget {
  final AppState m;
  final Json booking;
  const BookingDetail(this.m, this.booking, {super.key});
  @override
  Widget build(BuildContext c) => ListenableBuilder(
    listenable: m,
    builder: (c, _) {
      final matches = m.bookings.where((b) => b['id'] == booking['id']);
      if (matches.isEmpty) return Sheet('예약', [note('삭제된 예약입니다.')]);
      final b = matches.first;
      return Sheet('예약 정보', [
        gap(10),
        Text(
          b['purpose'],
          style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w700),
        ),
        gap(24),
        Text(b['date']),
        gap(12),
        Text(
          '${clockText(b['start'])}–${clockText(b['end'])}',
          style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w700),
        ),
        gap(16),
        note('${b['name']} · ${b['people']}명'),
        gap(32),
        if (b['owner'] == 'me') ...[
          ActionButton('시간·예약 정보 변경', () async {
            open(
              c,
              BookingForm(
                m,
                date: DateTime.parse(b['date']),
                start: b['start'],
                end: b['end'],
                booking: b,
              ),
            );
          }),
          gap(12),
          ActionButton('예약 취소', () async {
            if (!await confirm(
              c,
              '예약을 취소할까요?',
              '취소하면 다른 회원이 이 시간을 예약할 수 있습니다.',
              action: '예약 취소',
            )) {
              return;
            }
            await m.mutate('/bookings/${b['id']}', method: 'DELETE');
            if (c.mounted) Navigator.pop(c);
          }, outlined: true),
        ],
      ]);
    },
  );
}
