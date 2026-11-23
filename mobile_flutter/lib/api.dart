import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';

typedef Json = Map<String, dynamic>;
const native = MethodChannel('kr.ac.sejong.sai/native');
const apiOrigin = String.fromEnvironment(
  'SAI_API_ORIGIN',
  defaultValue: 'https://sai-room.vercel.app',
);
const policyVersion = '2026-11-23';

class ApiFailure implements Exception {
  final String code;
  final int status;
  const ApiFailure(this.code, [this.status = 0]);
  @override
  String toString() =>
      const {
        'INVALID_CREDENTIALS': '이메일 또는 비밀번호를 확인해주세요.',
        'PASSWORD_MISMATCH': '현재 비밀번호를 확인해주세요.',
        'ACCOUNT_UNAVAILABLE': '이미 가입된 이메일 또는 학번입니다.',
        'INVALID_OPERATOR_CODE': '운영진 코드를 확인해주세요.',
        'BOOKING_CONFLICT': '다른 예약과 시간이 겹칩니다.',
        'INVALID_BOOKING': '미래 날짜와 30분 단위 시간을 선택해주세요.',
        'INVALID_INPUT': '입력한 내용을 확인해주세요.',
        'CONTENT_NOT_ALLOWED': '다른 회원을 위협하거나 불쾌하게 하는 내용을 수정해주세요.',
        'LAST_ADMIN_TRANSFER_REQUIRED':
            '회원 관리에서 다른 승인 회원에게 관리자 권한을 넘긴 후 탈퇴해주세요.',
        'COMMUNITY_CONSENT_REQUIRED': '커뮤니티 이용 수칙에 먼저 동의해주세요.',
        'BEACON_NOT_CONFIGURED': '동방 비콘 설치가 아직 완료되지 않았습니다.',
        'AUTH_REQUIRED': '로그인 시간이 만료되었습니다. 다시 로그인해주세요.',
        'CODE_VERSION_CONFLICT': '다른 운영진이 코드를 변경했습니다. 다시 확인해주세요.',
        'NETWORK': '연결을 확인한 뒤 다시 시도해주세요.',
      }[code] ??
      (status == 429 ? '잠시 후 다시 시도해주세요.' : '요청을 처리하지 못했습니다. 다시 시도해주세요.');
}

class Api {
  final http.Client client;
  String cookie = '', csrf = '';
  final Map<String, String> _retryKeys = {};
  Api({http.Client? client}) : client = client ?? http.Client();
  Future<void> restore() async {
    final uri = Uri.parse(apiOrigin);
    if (uri.scheme != 'https' &&
        !(kDebugMode &&
            ['127.0.0.1', 'localhost', '10.0.2.2'].contains(uri.host))) {
      throw const ApiFailure('INVALID_ORIGIN');
    }
    cookie =
        await native.invokeMethod<String>('secureRead', {'key': 'session'}) ??
        '';
  }

  Future<void> forget() async {
    cookie = '';
    csrf = '';
    _retryKeys.clear();
    await native.invokeMethod('secureWrite', {'key': 'session', 'value': ''});
  }

  Future<dynamic> call(String path, {String method = 'GET', Json? body}) async {
    final write = method != 'GET';
    final sensitive =
        path.startsWith('/auth/') ||
        path == '/me/account' ||
        path == '/admin/transfer' ||
        path == '/staff/operator-code';
    final fingerprint = sensitive ? null : '$method $path ${jsonEncode(body)}';
    final key = write
        ? (fingerprint == null
              ? const Uuid().v4()
              : _retryKeys.putIfAbsent(fingerprint, () => const Uuid().v4()))
        : '';
    try {
      final request = http.Request(method, Uri.parse('$apiOrigin/api/v1$path'));
      request.followRedirects = false;
      request.headers.addAll({
        'Accept': 'application/json',
        if (cookie.isNotEmpty) 'Cookie': cookie,
        if (write) 'X-CSRF-Token': csrf,
        if (write) 'Idempotency-Key': key,
      });
      if (body != null) {
        request.headers['Content-Type'] = 'application/json';
        request.body = jsonEncode(body);
      }
      final response = await http.Response.fromStream(
        await client.send(request).timeout(const Duration(seconds: 15)),
      ).timeout(const Duration(seconds: 15));
      final setCookie = response.headers['set-cookie'];
      if (setCookie != null) {
        cookie = setCookie.split(';').first;
        await native.invokeMethod('secureWrite', {
          'key': 'session',
          'value': cookie,
        });
      }
      dynamic value;
      if (response.body.isNotEmpty) {
        try {
          value = jsonDecode(utf8.decode(response.bodyBytes));
        } catch (_) {
          throw const ApiFailure('NETWORK');
        }
      }
      if (response.statusCode >= 300) {
        if (response.statusCode < 500 && fingerprint != null) {
          _retryKeys.remove(fingerprint);
        }
        throw ApiFailure(
          value?['error']?['code'] ?? 'REQUEST_FAILED',
          response.statusCode,
        );
      }
      if (fingerprint != null) _retryKeys.remove(fingerprint);
      return value;
    } on ApiFailure {
      rethrow;
    } catch (_) {
      throw const ApiFailure('NETWORK');
    }
  }

  Future<Uint8List> image(String path) async {
    final uri = Uri.parse(path);
    if (uri.hasScheme || !path.startsWith('/media/balls/')) {
      throw const ApiFailure('INVALID_IMAGE');
    }
    final r = await client
        .get(Uri.parse('$apiOrigin$path'), headers: {'Cookie': cookie})
        .timeout(const Duration(seconds: 15));
    if (r.statusCode != 200) throw const ApiFailure('IMAGE_UNAVAILABLE');
    return r.bodyBytes;
  }

  Future<void> preauth() async {
    csrf = (await call('/auth/csrf'))['csrfToken'];
  }
}

class AppState extends ChangeNotifier {
  final Api api;
  Json? data, presence;
  bool loading = true, refreshBusy = false;
  String? error;
  Timer? timer;
  AppState(this.api);
  Json? get user => data?['user'];
  bool get approved => user?['membershipStatus'] == 'approved';
  bool get staff => ['operator', 'admin'].contains(user?['role']);
  bool get admin => user?['role'] == 'admin';
  List<Json> get bookings => List<Json>.from(data?['bookings'] ?? []);
  List<Json> get posts => List<Json>.from(data?['posts'] ?? []);
  Future<void> initialize() async {
    try {
      await api.restore();
      await refresh();
    } catch (e) {
      error = e.toString();
    }
    loading = false;
    notifyListeners();
  }

  Future<void> refresh() async {
    if (refreshBusy) return;
    refreshBusy = true;
    try {
      data = await api.call('/bootstrap');
      api.csrf = data!['csrfToken'];
      error = null;
      if (approved) await poll();
    } on ApiFailure catch (e) {
      if (e.status == 401) {
        data = null;
        presence = null;
        await api.forget();
      } else {
        error = e.toString();
      }
    } finally {
      refreshBusy = false;
      notifyListeners();
    }
  }

  Future<void> poll() async {
    if (!approved) return;
    try {
      presence = await api.call('/rooms/sai-room/occupants');
      error = null;
      notifyListeners();
    } on ApiFailure catch (e) {
      if (e.status == 401) {
        data = null;
        presence = null;
        await api.forget();
      }
      error = e.toString();
      notifyListeners();
    }
  }

  void resume() {
    timer?.cancel();
    if (approved) {
      poll();
      timer = Timer.periodic(const Duration(seconds: 15), (_) => poll());
    }
  }

  void pause() {
    timer?.cancel();
    timer = null;
  }

  Future<void> login(String email, String password) async {
    await api.preauth();
    await api.call(
      '/auth/login',
      method: 'POST',
      body: {'email': email, 'password': password},
    );
    await refresh();
    resume();
  }

  Future<void> signout() async {
    final status =
        await native.invokeMapMethod<String, dynamic>('beaconStatus') ?? {};
    if (status['paired'] == true) {
      await api.call('/beacon/devices', method: 'DELETE');
    }
    await native.invokeMethod('beaconDisable');
    await api.call('/auth/logout', method: 'POST');
    await api.forget();
    pause();
    data = null;
    presence = null;
    notifyListeners();
  }

  Future<void> mutate(String path, {String method = 'POST', Json? body}) async {
    await api.call(path, method: method, body: body);
    await refresh();
  }

  @override
  void dispose() {
    pause();
    api.client.close();
    super.dispose();
  }
}
